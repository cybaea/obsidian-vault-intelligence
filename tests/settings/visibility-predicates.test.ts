import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

// Structural shape for testing the declarative definitions. We only need
// to locate render entries and invoke their `visible` callbacks.
interface DefinitionRender {
    desc?: string;
    name?: string;
    render?: unknown;
    visible?: () => boolean;
}

interface DefinitionGroup {
    heading?: string;
    items?: DefinitionItem[];
    type?: string;
}

type DefinitionItem = DefinitionRender | DefinitionGroup;

interface DefinitionPage {
    desc?: string;
    items?: DefinitionItem[];
    name: string;
    page?: () => unknown;
    type: string;
}

function isGroup(item: DefinitionItem): item is DefinitionGroup {
    return (item as DefinitionGroup).type === 'group' || Array.isArray((item as DefinitionGroup).items);
}

function isRender(item: DefinitionItem): item is DefinitionRender {
    return typeof (item as DefinitionRender).render === 'function' || (item as DefinitionRender).name !== undefined;
}

/**
 * Recursively search a page's items (including nested groups) for a render
 * entry with the given setting name.
 */
function findDefinition(page: DefinitionPage | undefined, settingName: string): DefinitionRender | undefined {
    if (!page?.items) return undefined;
    return searchItems(page.items, settingName);
}

function searchItems(items: DefinitionItem[], settingName: string): DefinitionRender | undefined {
    for (const item of items) {
        if (isRender(item) && item.name === settingName) {
            return item;
        }
        if (isGroup(item) && item.items) {
            const found = searchItems(item.items, settingName);
            if (found) return found;
        }
    }
    return undefined;
}

describe('visibility predicates (T3)', () => {
    let tab: VaultIntelligenceSettingTab;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;

    function buildPlugin(settings: Partial<VaultIntelligenceSettings>): void {
        mockSettings = settings as unknown as VaultIntelligenceSettings;
        mockPlugin = {
            app: mockApp,
            embeddingService: {},
            geminiService: {},
            graphService: {},
            graphSyncOrchestrator: {},
            manifest: { id: 'vault-intelligence' },
            mcpClientManager: {},
            persistenceManager: {},
            requiresIndexWipeOnExit: false,
            requiresWorkerRestartOnExit: false,
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;
        tab = new VaultIntelligenceSettingTab(mockApp, mockPlugin);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.13.0');
        mockApp = {} as unknown as App;
    });

    describe('isCustomChatModel', () => {
        it('returns true when chatModel is not in known models and a provider is configured', () => {
            buildPlugin({
                chatModel: 'some-unknown-model',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom chat model');
            expect(def?.visible).toBeDefined();
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when chatModel is a known model', () => {
            buildPlugin({
                chatModel: 'gemini-flash-latest',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom chat model');
            expect(def?.visible).toBeDefined();
            expect(def?.visible?.()).toBe(false);
        });

        it('returns false when no provider is configured', () => {
            buildPlugin({
                chatModel: 'some-unknown-model',
                googleApiKey: '',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom chat model');
            expect(def?.visible).toBeDefined();
            expect(def?.visible?.()).toBe(false);
        });

        it('returns true when ollama endpoint is set and model is unknown', () => {
            buildPlugin({
                chatModel: 'some-unknown-model',
                googleApiKey: '',
                hiddenModels: [],
                ollamaEndpoint: 'http://localhost:11434',
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom chat model');
            expect(def?.visible?.()).toBe(true);
        });
    });

    describe('isCustomLanguage', () => {
        it('returns true when agentLanguage is not in COMMON_LANGUAGES', () => {
            buildPlugin({ agentLanguage: 'Klingon', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom language code');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when agentLanguage is a common language', () => {
            buildPlugin({ agentLanguage: 'English (US)', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom language code');
            expect(def?.visible?.()).toBe(false);
        });

        it('returns true when agentLanguage is empty (falls back to default which is common, so false)', () => {
            buildPlugin({ agentLanguage: '', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom language code');
            // Empty falls back to DEFAULT_LANGUAGE ('English (US)') which is common
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isOnlineEmbeddingProvider', () => {
        it('returns true for gemini', () => {
            buildPlugin({ embeddingProvider: 'gemini', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Embedding model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns true for ollama', () => {
            buildPlugin({ embeddingProvider: 'ollama', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Embedding model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns true for voyage', () => {
            buildPlugin({ embeddingProvider: 'voyage', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Embedding model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false for local', () => {
            buildPlugin({ embeddingProvider: 'local', hiddenModels: [] });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Embedding model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomEmbeddingModel', () => {
        it('returns true when embeddingModel is not known for the provider and key is set', () => {
            buildPlugin({
                embeddingModel: 'custom-embed-model',
                embeddingProvider: 'gemini',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom embedding model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when embeddingModel is known for the provider', () => {
            buildPlugin({
                embeddingModel: 'gemini-embedding-001',
                embeddingProvider: 'gemini',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom embedding model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomLocalModel', () => {
        it('returns true when embeddingModel is not a known local model', () => {
            buildPlugin({
                embeddingModel: 'local/some-unknown-model',
                embeddingProvider: 'local',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom local model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when embeddingModel is a known local model', () => {
            buildPlugin({
                embeddingModel: 'local/Xenova/multilingual-e5-small',
                embeddingProvider: 'local',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom local model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomReRankingModel', () => {
        it('returns true when reRankingModel is not in known chat models', () => {
            buildPlugin({
                enableDualLoop: true,
                hiddenModels: [],
                reRankingModel: 'unknown-rerank-model',
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom re-ranking model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when reRankingModel is a known model', () => {
            buildPlugin({
                enableDualLoop: true,
                hiddenModels: [],
                reRankingModel: 'gemini-flash-latest',
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const explorer = defs.find(d => d.name === 'Explorer');
            const def = findDefinition(explorer, 'Custom re-ranking model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomGardenerModel', () => {
        it('returns true when gardenerModel is not known and provider is configured', () => {
            buildPlugin({
                gardenerModel: 'unknown-gardener-model',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const gardener = defs.find(d => d.name === 'Gardener');
            const def = findDefinition(gardener, 'Custom gardener model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when gardenerModel is a known model', () => {
            buildPlugin({
                gardenerModel: 'gemini-flash-latest',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const gardener = defs.find(d => d.name === 'Gardener');
            const def = findDefinition(gardener, 'Custom gardener model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomCodeModel', () => {
        it('returns true when codeModel is not known and provider is configured', () => {
            buildPlugin({
                codeModel: 'unknown-code-model',
                enableCodeExecution: true,
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom code model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when codeModel is a known model', () => {
            buildPlugin({
                codeModel: 'gemini-flash-latest',
                enableCodeExecution: true,
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom code model');
            expect(def?.visible?.()).toBe(false);
        });
    });

    describe('isCustomGroundingModel', () => {
        it('returns true when groundingModel is not known and google key is set', () => {
            buildPlugin({
                enableWebSearch: true,
                googleApiKey: 'test-key',
                groundingModel: 'unknown-grounding-model',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom web search model');
            expect(def?.visible?.()).toBe(true);
        });

        it('returns false when groundingModel is a known model', () => {
            buildPlugin({
                enableWebSearch: true,
                googleApiKey: 'test-key',
                groundingModel: 'gemini-flash-lite-latest',
                hiddenModels: [],
            });
            const defs = tab.getSettingDefinitions() as unknown as DefinitionPage[];
            const researcher = defs.find(d => d.name === 'Researcher');
            const def = findDefinition(researcher, 'Custom web search model');
            expect(def?.visible?.()).toBe(false);
        });
    });
});