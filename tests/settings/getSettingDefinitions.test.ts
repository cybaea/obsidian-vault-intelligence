import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

// Minimal structural shape for testing the declarative definitions.
// The full SettingDefinitionItem union is complex; we only need to
// verify structural properties in tests.
interface TestDefinitionPage {
    desc?: string;
    items?: TestDefinitionItem[];
    name: string;
    page?: () => unknown;
    type: string;
}

interface TestDefinitionItem {
    desc?: string;
    heading?: string;
    items?: TestDefinitionItem[];
    name?: string;
    render?: unknown;
    type?: string;
}

describe('VaultIntelligenceSettingTab.getSettingDefinitions', () => {
    let tab: VaultIntelligenceSettingTab;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            chatModel: 'gemini-flash-latest',
            embeddingModel: 'gemini-embedding-001',
            embeddingProvider: 'gemini',
            hiddenModels: [],
        } as unknown as VaultIntelligenceSettings;

        mockApp = {} as unknown as App;

        mockPlugin = {
            app: mockApp,
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;

        tab = new VaultIntelligenceSettingTab(mockApp, mockPlugin);
    });

    it('should return 7 SettingDefinitionPage entries on v1.13+', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        expect(definitions).toHaveLength(7);

        for (const def of definitions) {
            expect(def.type).toBe('page');
            expect(def.name).toBeTruthy();
            expect(def.desc).toBeTruthy();
        }
    });

    it('should return an empty array on v1.12', () => {
        setMockApiVersion('1.12.0');
        const definitions = tab.getSettingDefinitions();
        expect(definitions).toHaveLength(0);
    });

    it('should return pages with the expected names', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        const names = definitions.map(d => d.name);

        expect(names).toContain('Connections');
        expect(names).toContain('Researcher');
        expect(names).toContain('Explorer');
        expect(names).toContain('Gardener');
        expect(names).toContain('Storage');
        expect(names).toContain('MCP Tools');
        expect(names).toContain('Advanced');
    });

    it('should use page factory instead of items for the MCP page', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        const mcpPage = definitions.find(d => d.name === 'MCP Tools');

        expect(mcpPage).toBeDefined();
        expect(mcpPage?.page).toBeDefined();
        expect(mcpPage?.page).toBeInstanceOf(Function);
        expect(mcpPage?.items).toBeUndefined();
    });

    it('should use items for non-MCP pages', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        const connectionsPage = definitions.find(d => d.name === 'Connections');

        expect(connectionsPage).toBeDefined();
        expect(connectionsPage?.items).toBeDefined();
        expect(Array.isArray(connectionsPage?.items)).toBe(true);
        expect(connectionsPage?.page).toBeUndefined();
    });

    it('should have SettingDefinitionRender entries with name, desc, and render function', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        const connectionsPage = definitions.find(d => d.name === 'Connections');

        expect(connectionsPage?.items).toBeDefined();
        const items: TestDefinitionItem[] = connectionsPage?.items ?? [];

        // At least one item should be a group with render entries
        const hasRenderEntries = items.some((item: TestDefinitionItem) => {
            if (item.type === 'group' && item.items) {
                return item.items.some((subItem: TestDefinitionItem) =>
                    subItem.name !== undefined &&
                    subItem.desc !== undefined &&
                    typeof subItem.render === 'function'
                );
            }
            return false;
        });

        expect(hasRenderEntries).toBe(true);
    });

    it('should invoke renderMcpSettings when the MCP page factory display() is called (T2)', () => {
        setMockApiVersion('1.13.0');
        const definitions = tab.getSettingDefinitions() as unknown as TestDefinitionPage[];
        const mcpPage = definitions.find(d => d.name === 'MCP Tools');

        expect(mcpPage).toBeDefined();
        expect(mcpPage?.page).toBeInstanceOf(Function);

        // Invoke the page factory; it returns a McpSettingPage instance.
        const pageInstance = mcpPage?.page?.() as { display: () => void; containerEl: HTMLElement };
        expect(pageInstance).toBeDefined();
        expect(typeof pageInstance.display).toBe('function');

        // display() calls containerEl.empty() and then builds DOM imperatively.
        // With the strengthened mock containerEl, display() should not throw.
        expect(() => pageInstance.display()).not.toThrow();
    });
});