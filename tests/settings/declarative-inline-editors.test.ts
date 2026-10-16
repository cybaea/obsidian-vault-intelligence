import type { Setting, SettingGroup } from 'obsidian';

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { type IVaultIntelligencePlugin, type VaultIntelligenceSettings } from '../../src/settings/types';
import { MockSetting } from '../helpers/MockSetting';
import { setMockApiVersion } from '../mocks/obsidian';

/**
 * Regression tests for inline editors hosted inside declarative setting
 * rows (the HTTP headers key-value editors and the storage shards list).
 *
 * Obsidian's declarative settings renderer (v1.13+) rebuilds each group's
 * list after every render pass, keeping only the tracked setting rows and
 * detaching anything a render callback appended directly to the group
 * container. A render closure that appends to `group.listEl` therefore
 * disappears between passes, leaving the setting's name and description
 * without its editor. The contract these tests encode: the editor must be
 * hosted INSIDE the row (below the info area) and must return a cleanup
 * function so `update()` re-renders (where `Setting.clear()` only empties
 * the control area) cannot stack duplicate editors.
 */
type RenderFn = (setting: Setting, group: SettingGroup) => void | (() => void);

interface TestItem {
    heading?: string;
    items?: TestItem[];
    name?: string;
    render?: RenderFn;
    type?: string;
}

interface TestPage {
    items?: TestItem[];
    name?: string;
    type?: string;
}

function makePlugin(withPersistence: boolean): IVaultIntelligencePlugin {
    return {
        app: {
            setting: { openTabById: vi.fn() },
            workspace: undefined
        },
        geminiService: { getApiKey: vi.fn().mockResolvedValue('google-key') },
        manifest: { dir: 'plugins/vault-intelligence', id: 'vault-intelligence' },
        mcpClientManager: {},
        persistenceManager: withPersistence
            ? {
                getSanitizedModelId: vi.fn().mockReturnValue('abc'),
                listAvailableStates: vi.fn().mockResolvedValue(['graph-state-abc.msgpack'])
            }
            : undefined,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        settings: {
            chatModel: 'gemini-flash-latest',
            embeddingDimension: 768,
            embeddingModel: 'gemini-embedding-001',
            embeddingProvider: 'gemini',
            hiddenModels: []
        } as unknown as VaultIntelligenceSettings
    } as unknown as IVaultIntelligencePlugin;
}

function makeTabs(): { groupElCalls: Mock; listEl: { createDiv: Mock }; plugin: IVaultIntelligencePlugin; tab: VaultIntelligenceSettingTab } {
    const plugin = makePlugin(true);
    const tab = new VaultIntelligenceSettingTab({} as never, plugin);
    const listEl = { createDiv: vi.fn() as unknown as Mock };
    return { groupElCalls: vi.fn(), listEl, plugin, tab };
}

function makeGroup(listEl: unknown): SettingGroup {
    return { listEl } as unknown as SettingGroup;
}

function findItemByName(pages: TestPage[], pageName: string, groupName: string, itemName: string): TestItem | undefined {
    const page = pages.find((p) => p.name === pageName);
    const groups = page?.items ?? [];
    const group = groups.find((g) => g.heading === groupName);
    const items = group?.items ?? [];
    return items.find((item) => item.name === itemName);
}

describe('declarative inline editors are hosted inside their setting row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.13.0');
    });

    it('renders the Ollama headers editor into the row, not the group list', () => {
        const { listEl, tab } = makeTabs();
        const pages = tab.getSettingDefinitions() as unknown as TestPage[];
        const definition = findItemByName(pages, 'Connections', 'Connection settings', 'Ollama headers');
        expect(definition?.render).toBeTypeOf('function');

        const setting = new MockSetting();
        const settingElCreate = setting.settingEl.createDiv as Mock;
        const cleanup = (definition?.render as RenderFn)(setting as unknown as Setting, makeGroup(listEl));

        // The group container must be left untouched: the renderer replaces
        // its children with the tracked rows only, wiping anything else.
        expect(listEl.createDiv).not.toHaveBeenCalled();

        // The editor host lives inside the row (survives list rebuilds).
        expect(settingElCreate).toHaveBeenCalledWith(expect.objectContaining({ cls: 'vi-kv-editor-host' }));
        const host = settingElCreate.mock.results[0]?.value;
        expect(host).toBeDefined();

        // The render closure must return the renderer's cleanup contract.
        expect(cleanup).toBeTypeOf('function');
        expect(host.remove).not.toHaveBeenCalled();
        (cleanup as () => void)();
        expect(host.remove).toHaveBeenCalledOnce();
    });

    it('renders the OpenAI-compatible headers editor into the row, not the group list', () => {
        const { listEl, tab } = makeTabs();
        const pages = tab.getSettingDefinitions() as unknown as TestPage[];
        const definition = findItemByName(pages, 'Connections', 'Connection settings', 'OpenAI-compatible headers');
        expect(definition?.render).toBeTypeOf('function');

        const setting = new MockSetting();
        const settingElCreate = setting.settingEl.createDiv as Mock;
        const cleanup = (definition?.render as RenderFn)(setting as unknown as Setting, makeGroup(listEl));

        expect(listEl.createDiv).not.toHaveBeenCalled();
        expect(settingElCreate).toHaveBeenCalledWith(expect.objectContaining({ cls: 'vi-kv-editor-host' }));
        const host = settingElCreate.mock.results[0]?.value;
        expect(cleanup).toBeTypeOf('function');
        (cleanup as () => void)();
        expect(host.remove).toHaveBeenCalledOnce();
    });

    it('renders the storage shards list into the row, not the group list', async () => {
        const { listEl, plugin, tab } = makeTabs();
        const pages = tab.getSettingDefinitions() as unknown as TestPage[];
        const definition = findItemByName(pages, 'Storage', 'Active database shards', 'Database shards');
        expect(definition?.render).toBeTypeOf('function');

        const setting = new MockSetting();
        const settingElCreate = setting.settingEl.createDiv as Mock;
        const cleanup = (definition?.render as RenderFn)(setting as unknown as Setting, makeGroup(listEl));

        expect(listEl.createDiv).not.toHaveBeenCalled();
        expect(settingElCreate).toHaveBeenCalledWith(expect.objectContaining({ cls: 'vi-kv-editor-host' }));
        const host = settingElCreate.mock.results[0]?.value;
        expect(cleanup).toBeTypeOf('function');

        // The async shards list populates the host content (skeleton painted
        // synchronously, states fetched inside the host), not the group list.
        await vi.waitFor(() => {
            expect(plugin.persistenceManager.listAvailableStates).toHaveBeenCalled();
        });
        const hostCreateDiv = host.createDiv as Mock;
        expect(hostCreateDiv).toHaveBeenCalledWith('vi-storage-list');

        (cleanup as () => void)();
        expect(host.remove).toHaveBeenCalledOnce();
    });

    it('does not stack duplicate hosts across update() re-render passes', () => {
        const { listEl, tab } = makeTabs();
        const pages = tab.getSettingDefinitions() as unknown as TestPage[];
        const definition = findItemByName(pages, 'Connections', 'Connection settings', 'Ollama headers');
        expect(definition?.render).toBeTypeOf('function');

        const setting = new MockSetting();
        const settingElCreate = setting.settingEl.createDiv as Mock;

        // First pass, then the cleanup the renderer invokes before tearing
        // the row contents down, then an update() pass re-running render.
        const firstCleanup = (definition?.render as RenderFn)(setting as unknown as Setting, makeGroup(listEl));
        expect(settingElCreate).toHaveBeenCalledOnce();
        firstCleanup?.();
        expect((settingElCreate.mock.results[0]?.value as { remove: Mock }).remove).toHaveBeenCalledOnce();

        const secondCleanup = (definition?.render as RenderFn)(setting as unknown as Setting, makeGroup(listEl));
        expect(settingElCreate).toHaveBeenCalledTimes(2);
        secondCleanup?.();
        expect((settingElCreate.mock.results[1]?.value as { remove: Mock }).remove).toHaveBeenCalledOnce();
    });
});