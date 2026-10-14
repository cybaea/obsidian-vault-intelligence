import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshSettings, refreshVisibility, reRenderSection } from '../../src/settings/refreshSettings';
import { configureGoogleApiKeyField, configureOllamaEndpointField, configureVoyageApiKeyField } from '../../src/settings/sections/connections';
import { configureEnableDualLoopField, configureEmbeddingProviderField } from '../../src/settings/sections/explorer';
import { configureChatModelField } from '../../src/settings/sections/researcher';
import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { SettingsTabContext } from '../../src/settings/SettingsTabContext';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { MockSetting } from '../helpers/MockSetting';
import { setMockApiVersion } from '../mocks/obsidian';

// Stub the refresh utilities so we can assert which one a render closure calls
// without depending on the real implementation's DOM interactions.
vi.mock('../../src/settings/refreshSettings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/settings/refreshSettings')>();
    return {
        ...actual,
        refreshSettings: vi.fn(),
        refreshVisibility: vi.fn(),
        reRenderSection: vi.fn(),
    };
});

function makePlugin(settings: Partial<VaultIntelligenceSettings>): IVaultIntelligencePlugin {
    return {
        app: {},
        embeddingService: {},
        geminiService: {},
        graphService: {},
        graphSyncOrchestrator: { updateConfig: vi.fn().mockResolvedValue(undefined) },
        manifest: { id: 'vault-intelligence' },
        mcpClientManager: {},
        persistenceManager: {},
        requiresIndexWipeOnExit: false,
        requiresWorkerRestartOnExit: false,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        settings: settings as VaultIntelligenceSettings,
    } as unknown as IVaultIntelligencePlugin;
}

function makeContext(plugin: IVaultIntelligencePlugin): SettingsTabContext {
    return {
        app: {},
        containerEl: { createDiv: vi.fn(), empty: vi.fn() } as unknown as HTMLElement,
        plugin,
        tabInstance: { refreshDomState: vi.fn(), update: vi.fn() } as unknown as VaultIntelligenceSettingTab,
    } as unknown as SettingsTabContext;
}

describe('render closures (T1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.13.0');
    });

    describe('configureChatModelField (D2 fix)', () => {
        it('should set requiresWorkerRestartOnExit and saveSettings(true) when a preset model is selected', async () => {
            const plugin = makePlugin({
                chatModel: 'gemini-flash-latest',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureChatModelField(setting as any, plugin, context);
            await setting.fireDropdown('gemini-pro-latest');

            expect(plugin.settings.chatModel).toBe('gemini-pro-latest');
            expect(plugin.requiresWorkerRestartOnExit).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalledWith(true);
            expect(refreshVisibility).toHaveBeenCalledWith(context);
        });

        it('should NOT update chatModel or set requiresWorkerRestartOnExit when custom is selected', async () => {
            const plugin = makePlugin({
                chatModel: 'gemini-flash-latest',
                googleApiKey: 'test-key',
                hiddenModels: [],
            });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureChatModelField(setting as any, plugin, context);
            await setting.fireDropdown('custom');

            expect(plugin.settings.chatModel).toBe('gemini-flash-latest');
            expect(plugin.requiresWorkerRestartOnExit).toBe(false);
            expect(plugin.saveSettings).not.toHaveBeenCalledWith(true);
            expect(refreshVisibility).toHaveBeenCalledWith(context);
        });

        it('should call setName("Chat model") and setDesc', () => {
            const plugin = makePlugin({ chatModel: 'gemini-flash-latest', googleApiKey: 'test-key', hiddenModels: [] });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureChatModelField(setting as any, plugin, context);

            expect(setting.name).toBe('Chat model');
            expect(setting.desc).toBeDefined();
        });
    });

    describe('configureEnableDualLoopField (S1 fix)', () => {
        it('should call refreshVisibility (not renderExplorerSettings or reRenderSection) when toggled', async () => {
            const plugin = makePlugin({ enableDualLoop: true, hiddenModels: [] });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureEnableDualLoopField(setting as any, plugin, context);
            await setting.fireToggle(false);

            expect(plugin.settings.enableDualLoop).toBe(false);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
            expect(refreshVisibility).toHaveBeenCalledWith(context);
            expect(reRenderSection).not.toHaveBeenCalled();
            expect(refreshSettings).not.toHaveBeenCalled();
        });

        it('should call setName("Enable dual-loop search")', () => {
            const plugin = makePlugin({ enableDualLoop: true, hiddenModels: [] });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureEnableDualLoopField(setting as any, plugin, context);

            expect(setting.name).toBe('Enable dual-loop search');
        });
    });

    describe('configureEmbeddingProviderField', () => {
        it('should set embedding provider, model, dimension, requiresIndexWipeOnExit, and call reRenderSection on change', async () => {
            const plugin = makePlugin({
                agentLanguage: 'English (US)',
                embeddingChunkSize: 1024,
                embeddingDimension: 768,
                embeddingModel: 'gemini-embedding-001',
                embeddingProvider: 'gemini',
                hiddenModels: [],
            });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureEmbeddingProviderField(setting as any, plugin, context);
            await setting.fireDropdown('voyage');

            expect(plugin.settings.embeddingProvider).toBe('voyage');
            expect(plugin.settings.embeddingChunkSize).toBe(1024);
            expect(plugin.requiresIndexWipeOnExit).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalledWith(false);
            expect(reRenderSection).toHaveBeenCalledWith(context, expect.any(Function));
        });

        it('should set chunk size to 512 for local provider', async () => {
            const plugin = makePlugin({
                agentLanguage: 'English (US)',
                embeddingChunkSize: 1024,
                embeddingDimension: 768,
                embeddingModel: 'gemini-embedding-001',
                embeddingProvider: 'gemini',
                hiddenModels: [],
            });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureEmbeddingProviderField(setting as any, plugin, context);
            await setting.fireDropdown('local');

            expect(plugin.settings.embeddingProvider).toBe('local');
            expect(plugin.settings.embeddingChunkSize).toBe(512);
        });
    });

    describe('configureOllamaEndpointField (D7 fix)', () => {
        it('should render the status badge into setting.controlEl, not context.containerEl', () => {
            const plugin = makePlugin({ hiddenModels: [], ollamaEndpoint: 'http://localhost:11434' });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureOllamaEndpointField(setting as any, plugin, context);

            expect(setting.controlEl.createDiv).toHaveBeenCalledWith({ cls: 'vi-ollama-status' });
            expect(context.containerEl.createDiv).not.toHaveBeenCalled();
        });

        it('should update ollamaEndpoint and saveSettings on text change', async () => {
            const plugin = makePlugin({ hiddenModels: [], ollamaEndpoint: '' });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureOllamaEndpointField(setting as any, plugin, context);
            await setting.fireText('http://localhost:11434');

            expect(plugin.settings.ollamaEndpoint).toBe('http://localhost:11434');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should prefix http:// when the URL has no scheme', async () => {
            const plugin = makePlugin({ hiddenModels: [], ollamaEndpoint: '' });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureOllamaEndpointField(setting as any, plugin, context);
            await setting.fireText('localhost:11434');

            expect(plugin.settings.ollamaEndpoint).toBe('http://localhost:11434');
        });
    });

    describe('configureGoogleApiKeyField (SecretComponent)', () => {
        const RAW_KEY = `AIza${'a'.repeat(35)}`;

        it('should store a raw Google API key and clear the secret reference', async () => {
            const plugin = makePlugin({ googleApiKey: '', googleApiKeySecret: '', hiddenModels: [] });
            (plugin as any).geminiService = { getApiKey: vi.fn() };
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureGoogleApiKeyField(setting as any, plugin, context);
            await setting.fireSecretChange(RAW_KEY);

            expect(plugin.settings.googleApiKey).toBe(RAW_KEY);
            expect(plugin.settings.googleApiKeySecret).toBe('');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should store a non-key value as a secret reference and clear the raw key', async () => {
            const plugin = makePlugin({ googleApiKey: RAW_KEY, googleApiKeySecret: '', hiddenModels: [] });
            (plugin as any).geminiService = { getApiKey: vi.fn() };
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureGoogleApiKeyField(setting as any, plugin, context);
            await setting.fireSecretChange('my-secret-ref');

            expect(plugin.settings.googleApiKeySecret).toBe('my-secret-ref');
            expect(plugin.settings.googleApiKey).toBe('');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should treat null (cleared secret input on Obsidian 1.14+) as empty, clearing key and secret reference', async () => {
            const plugin = makePlugin({ googleApiKey: RAW_KEY, googleApiKeySecret: 'stored-secret-ref', hiddenModels: [] });
            (plugin as any).geminiService = { getApiKey: vi.fn() };
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureGoogleApiKeyField(setting as any, plugin, context);
            await setting.fireSecretChange(null);

            expect(plugin.settings.googleApiKey).toBe('');
            expect(plugin.settings.googleApiKeySecret).toBe('');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });
    });

    describe('configureVoyageApiKeyField (SecretComponent)', () => {
        it('should store a raw Voyage key and clear the secret reference', async () => {
            const plugin = makePlugin({ hiddenModels: [], voyageApiKey: '', voyageApiKeySecret: '' });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureVoyageApiKeyField(setting as any, plugin, context);
            await setting.fireSecretChange('pa-abcdef123456');

            expect(plugin.settings.voyageApiKey).toBe('pa-abcdef123456');
            expect(plugin.settings.voyageApiKeySecret).toBe('');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should treat null (cleared secret input on Obsidian 1.14+) as empty, clearing key and secret reference', async () => {
            const plugin = makePlugin({ hiddenModels: [], voyageApiKey: 'pa-abcdef123456', voyageApiKeySecret: 'stored-secret-ref' });
            const context = makeContext(plugin);
            const setting = new MockSetting();

            configureVoyageApiKeyField(setting as any, plugin, context);
            await setting.fireSecretChange(null);

            expect(plugin.settings.voyageApiKey).toBe('');
            expect(plugin.settings.voyageApiKeySecret).toBe('');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });
    });
});