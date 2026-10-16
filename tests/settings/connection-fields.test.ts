import { Notice, Setting } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { CONNECTION_PRESETS } from '../../src/constants';
import { ModelRegistry } from '../../src/services/ModelRegistry';
import {
    configureConnectionPresetField,
    configureKiloApiKeyField,
    configureOllamaCloudApiKeyField,
    configureOllamaEndpointField,
    configureOpenAICompatEndpointField,
    configureRefreshModelListField,
    isConnectionAtPresetEndpoint,
    normalizeConnectionEndpoint,
    refreshModelList,
    renderConnectionSettings,
    withAuthorizationSecretIfAbsent
} from '../../src/settings/sections/connections';
import { type SettingsTabContext } from '../../src/settings/SettingsTabContext';
import { type IVaultIntelligencePlugin, type VaultIntelligenceSettings } from '../../src/settings/types';
import { MockSetting } from '../helpers/MockSetting';
import { setMockApiVersion } from '../mocks/obsidian';

vi.mock('../../src/services/ModelRegistry', () => ({
    ModelRegistry: {
        fetchModels: vi.fn().mockResolvedValue(undefined)
    }
}));

// The shared obsidian mock's Notice is an inert class; replace it with a
// callable spy so notice texts can be asserted.
vi.mock('obsidian', async (importOriginal) => {
    const original = await importOriginal<typeof import('../mocks/obsidian')>();
    return {
        ...original,
        Notice: Object.assign(vi.fn(), original.Notice)
    };
});

describe('connection endpoint and API key fields', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.13.0');
    });

    let secrets: { deleteSecret: Mock; getSecret: Mock; setSecret: Mock } | undefined;
    const makePlugin = (settings: Partial<VaultIntelligenceSettings>): IVaultIntelligencePlugin => {
        secrets = {
            deleteSecret: vi.fn(),
            getSecret: vi.fn().mockResolvedValue('token123'),
            setSecret: vi.fn()
        };
        return {
            app: {
                secretStorage: secrets,
                vault: { configDir: 'mock-config-dir' }
            },
            geminiService: { getApiKey: vi.fn().mockResolvedValue('google-key') },
            manifest: { dir: 'plugins/vault-intelligence', id: 'vault-intelligence' },
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: settings as VaultIntelligenceSettings
        } as unknown as IVaultIntelligencePlugin;
    };

    describe('normalizeConnectionEndpoint', () => {
        it('should return an empty string for empty input', () => {
            expect(normalizeConnectionEndpoint('')).toBe('');
            expect(normalizeConnectionEndpoint('   ')).toBe('');
        });

        it('should keep an explicitly typed scheme and strip trailing slashes', () => {
            expect(normalizeConnectionEndpoint('https://ollama.com/')).toBe('https://ollama.com');
            expect(normalizeConnectionEndpoint('HTTPS://Example.com//')).toBe('HTTPS://Example.com');
        });

        it('should default localhost and private hosts to http://', () => {
            expect(normalizeConnectionEndpoint('localhost:1234/v1')).toBe('http://localhost:1234/v1');
            expect(normalizeConnectionEndpoint('localhost:11434')).toBe('http://localhost:11434');
            expect(normalizeConnectionEndpoint('127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1');
            expect(normalizeConnectionEndpoint('10.0.0.5:8000')).toBe('http://10.0.0.5:8000');
            expect(normalizeConnectionEndpoint('192.168.1.50:1234/v1')).toBe('http://192.168.1.50:1234/v1');
            expect(normalizeConnectionEndpoint('172.20.1.5:8000/v1')).toBe('http://172.20.1.5:8000/v1');
            expect(normalizeConnectionEndpoint('mybox.local:1234')).toBe('http://mybox.local:1234');
            expect(normalizeConnectionEndpoint('foo.localhost:1234')).toBe('http://foo.localhost:1234');
            expect(normalizeConnectionEndpoint('[::1]:11434/v1')).toBe('http://[::1]:11434/v1');
        });

        it('should default web hosts to https://', () => {
            expect(normalizeConnectionEndpoint('ai-gateway.kilo.ai/api/v1')).toBe('https://ai-gateway.kilo.ai/api/v1');
            expect(normalizeConnectionEndpoint('ollama.com')).toBe('https://ollama.com');
            expect(normalizeConnectionEndpoint('my-remote-server.example.com:8443/')).toBe('https://my-remote-server.example.com:8443');
        });
    });

    describe('isConnectionAtPresetEndpoint', () => {
        it('should return false for an unset endpoint', () => {
            expect(isConnectionAtPresetEndpoint(undefined, CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT)).toBe(false);
        });

        it('should match exact, trailing-slash, cased, and scheme-less variants', () => {
            expect(isConnectionAtPresetEndpoint('https://ai-gateway.kilo.ai/api/v1', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(true);
            expect(isConnectionAtPresetEndpoint('https://ai-gateway.kilo.ai/api/v1/', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(true);
            expect(isConnectionAtPresetEndpoint('HTTPS://AI-GATEWAY.KILO.AI/api/v1', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(true);
            expect(isConnectionAtPresetEndpoint('ai-gateway.kilo.ai/api/v1', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(true);
        });

        it('should not match a different host or path', () => {
            expect(isConnectionAtPresetEndpoint('http://localhost:1234/v1', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(false);
            expect(isConnectionAtPresetEndpoint('https://ai-gateway.kilo.ai', CONNECTION_PRESETS.KILO.ENDPOINT)).toBe(false);
            expect(isConnectionAtPresetEndpoint('https://my-remote-ollama.example.com', CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT)).toBe(false);
        });
    });

    describe('withAuthorizationSecretIfAbsent', () => {
        it('should plant the bare Authorization reference when none exists', () => {
            expect(JSON.parse(withAuthorizationSecretIfAbsent(undefined) ?? '')).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
            expect(JSON.parse(withAuthorizationSecretIfAbsent('{"X-Custom": "abc"}') ?? '')).toEqual({
                Authorization: 'vi-secret:Authorization',
                'X-Custom': 'abc'
            });
        });

        it('should return null (plant nothing) when an Authorization entry exists', () => {
            expect(withAuthorizationSecretIfAbsent('{"Authorization": "Bearer user-token"}')).toBeNull();
            expect(withAuthorizationSecretIfAbsent('{"Authorization": "vi-secret:Authorization"}')).toBeNull();
        });

        it('should recover from invalid JSON by planting the reference', () => {
            expect(JSON.parse(withAuthorizationSecretIfAbsent('not json') ?? '')).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
        });
    });

    describe('configureKiloApiKeyField', () => {
        it('should store the key and wire the Authorization reference on entry', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT });
            const setting = new MockSetting();

            configureKiloApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('kilo-key-123');

            expect(secrets?.setSecret).toHaveBeenCalledWith(CONNECTION_PRESETS.KILO.SECRET_NAME, 'kilo-key-123');
            expect(JSON.parse(plugin.settings.openaiCompatHeaders as string)).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should preserve a user-authored Authorization header instead of clobbering it', async () => {
            const plugin = makePlugin({
                openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT,
                openaiCompatHeaders: JSON.stringify({ Authorization: 'Bearer user-token' })
            });
            const setting = new MockSetting();

            configureKiloApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('kilo-key-123');

            expect(secrets?.setSecret).toHaveBeenCalledWith(CONNECTION_PRESETS.KILO.SECRET_NAME, 'kilo-key-123');
            expect(JSON.parse(plugin.settings.openaiCompatHeaders as string)).toEqual({
                Authorization: 'Bearer user-token'
            });
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            // Non-clobbering is surfaced, not silent: the stored key stays
            // unwired until the user resolves the plain-text entry.
            expect(Notice).toHaveBeenCalledWith(
                'An authorization header already exists in your headers; the key was stored but left unwired. Edit the headers or remove that entry first.'
            );
        });

        it('should stay silent when the existing Authorization entry is a secret reference', async () => {
            const plugin = makePlugin({
                openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT,
                openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });
            const setting = new MockSetting();

            configureKiloApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('kilo-key-123');

            // The stored reference is already wired and now resolves to the
            // freshly stored key, so no "left unwired" feedback may fire.
            expect(Notice).not.toHaveBeenCalled();
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should delete the stored key on clear', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT });
            const setting = new MockSetting();

            configureKiloApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('');

            expect(secrets?.deleteSecret).toHaveBeenCalledWith(CONNECTION_PRESETS.KILO.SECRET_NAME);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should not fire a network call from the key field wiring', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT });
            const setting = new MockSetting();

            configureKiloApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('kilo-key-123');

            expect(vi.mocked(ModelRegistry.fetchModels)).not.toHaveBeenCalled();
        });
    });

    describe('configureOllamaCloudApiKeyField', () => {
        it('should store the key and wire the Authorization reference on entry', async () => {
            const plugin = makePlugin({ ollamaEndpoint: CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT });
            const setting = new MockSetting();

            configureOllamaCloudApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('cloud-key-123');

            expect(secrets?.setSecret).toHaveBeenCalledWith(CONNECTION_PRESETS.OLLAMA_CLOUD.SECRET_NAME, 'cloud-key-123');
            expect(JSON.parse(plugin.settings.ollamaHeaders as string)).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should preserve a user-authored Authorization header instead of clobbering it', async () => {
            const plugin = makePlugin({
                ollamaEndpoint: CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT,
                ollamaHeaders: JSON.stringify({ Authorization: 'Bearer user-token', 'X-Mine': 'abc' })
            });
            const setting = new MockSetting();

            configureOllamaCloudApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('cloud-key-123');

            expect(JSON.parse(plugin.settings.ollamaHeaders as string)).toEqual({
                Authorization: 'Bearer user-token',
                'X-Mine': 'abc'
            });
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            // Non-clobbering is surfaced, not silent: the stored key stays
            // unwired until the user resolves the plain-text entry.
            expect(Notice).toHaveBeenCalledWith(
                'An authorization header already exists in your headers; the key was stored but left unwired. Edit the headers or remove that entry first.'
            );
        });

        it('should stay silent when the existing Authorization entry is a secret reference', async () => {
            const plugin = makePlugin({
                ollamaEndpoint: CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT,
                ollamaHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });
            const setting = new MockSetting();

            configureOllamaCloudApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('cloud-key-123');

            // The stored reference is already wired and now resolves to the
            // freshly stored key, so no "left unwired" feedback may fire.
            expect(Notice).not.toHaveBeenCalled();
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should delete the stored key on clear', async () => {
            const plugin = makePlugin({ ollamaEndpoint: CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT });
            const setting = new MockSetting();

            configureOllamaCloudApiKeyField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('');

            expect(secrets?.deleteSecret).toHaveBeenCalledWith(CONNECTION_PRESETS.OLLAMA_CLOUD.SECRET_NAME);
        });
    });

    describe('configureOpenAICompatEndpointField blur normalization', () => {
        it('should persist the typed value and normalize the canonical form on blur', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: '' });
            const setting = new MockSetting();

            configureOpenAICompatEndpointField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('localhost:1234/v1');

            expect(plugin.settings.openaiCompatEndpoint).toBe('localhost:1234/v1');
            expect(setting.textComponents[0]?.setValue).not.toHaveBeenCalledWith('https://localhost:1234/v1');

            await setting.fireTextEvent('blur');

            expect(plugin.settings.openaiCompatEndpoint).toBe('http://localhost:1234/v1');
            expect(setting.textComponents[0]?.setValue).toHaveBeenCalledWith('http://localhost:1234/v1');
            expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        });

        it('should skip the save and refresh when the value is already canonical', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: 'https://ollama.com' });
            const setting = new MockSetting();

            configureOpenAICompatEndpointField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            // The initial render itself calls setValue once with the stored value.
            const valueCalls = (setting.textComponents[0]?.setValue as Mock).mock.calls;
            expect(valueCalls).toHaveLength(1);

            await setting.fireTextEvent('blur');

            expect(valueCalls).toHaveLength(1);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should re-evaluate visibility predicates on a normalized blur (declarative)', async () => {
            setMockApiVersion('1.13.0');
            const plugin = makePlugin({ openaiCompatEndpoint: '' });
            const refreshDomState = vi.fn();
            const context = { tabInstance: { refreshDomState } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureOpenAICompatEndpointField(setting as unknown as Setting, plugin, context);
            await setting.fireText('ai-gateway.kilo.ai/api/v1');
            await setting.fireTextEvent('blur');

            expect(refreshDomState).toHaveBeenCalledOnce();
        });

        it('should not rebuild the imperative tab on blur (blur-to-click safety)', async () => {
            setMockApiVersion('1.12.0');
            const plugin = makePlugin({ openaiCompatEndpoint: '' });
            const setting = new MockSetting();

            configureOpenAICompatEndpointField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('ai-gateway.kilo.ai/api/v1');

            // Legacy path: refreshSettings would throw without app.setting;
            // skipping the rebuild must not throw and must not save a broken call.
            await expect(setting.fireTextEvent('blur')).resolves.toBeUndefined();
            expect(plugin.settings.openaiCompatEndpoint).toBe('https://ai-gateway.kilo.ai/api/v1');
        });
    });

    describe('configureOllamaEndpointField blur normalization', () => {
        it('should default a typed web host to https:// on blur', async () => {
            const plugin = makePlugin({ ollamaEndpoint: '' });
            const setting = new MockSetting();

            configureOllamaEndpointField(setting as unknown as Setting, plugin, {} as SettingsTabContext);
            await setting.fireText('my-remote-ollama.example.com');
            await setting.fireTextEvent('blur');

            expect(plugin.settings.ollamaEndpoint).toBe('https://my-remote-ollama.example.com');
        });
    });

    describe('configureConnectionPresetField model refresh', () => {
        it('should refresh the model list after applying a preset (best effort, forced update)', async () => {
            const plugin = makePlugin({ openaiCompatEndpoint: '' });
            const update = vi.fn();
            const context = { tabInstance: { update } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureConnectionPresetField(setting as unknown as Setting, plugin, context);
            await setting.fireDropdown('kilo');
            await vi.waitFor(() => {
                expect(vi.mocked(ModelRegistry.fetchModels)).toHaveBeenCalledOnce();
            });

            const calls = vi.mocked(ModelRegistry.fetchModels).mock.calls;
            expect(calls[0]?.[2]).toBe(plugin.settings);
            expect(calls[0]?.[5]).toBe(true); // forceUpdate: caches are not endpoint-keyed

            // On success the settings UI refreshes again and the same notice
            // the manual refresh button shows fires.
            await vi.waitFor(() => {
                expect(update).toHaveBeenCalledTimes(2);
            });
            expect(Notice).toHaveBeenCalledWith('Model list refreshed');
        });

        it('should not surface model fetch failures as preset failures', async () => {
            vi.mocked(ModelRegistry.fetchModels).mockRejectedValueOnce(new Error('network down'));
            const plugin = makePlugin({ openaiCompatEndpoint: '' });
            const context = { tabInstance: { update: vi.fn() } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureConnectionPresetField(setting as unknown as Setting, plugin, context);
            await setting.fireDropdown('kilo');
            await vi.waitFor(() => {
                expect(vi.mocked(ModelRegistry.fetchModels)).toHaveBeenCalledOnce();
            });

            // On failure stay silent: the "Test connection" probe is the
            // failure surface, and the preset-applied notice already fired.
            expect(Notice).not.toHaveBeenCalledWith('Model list refreshed');
        });

        it('should tolerate missing stored header secrets in the preset-triggered refresh', async () => {
            const plugin = makePlugin({
                openaiCompatEndpoint: '',
                openaiCompatHeaders: 'vi-secret-plant-later'
            });
            secrets?.getSecret.mockResolvedValue(null);
            const context = { tabInstance: { update: vi.fn() } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureConnectionPresetField(setting as unknown as Setting, plugin, context);
            await setting.fireDropdown('kilo');
            await vi.waitFor(() => {
                expect(vi.mocked(ModelRegistry.fetchModels)).toHaveBeenCalledOnce();
            });

            const calls = vi.mocked(ModelRegistry.fetchModels).mock.calls;
            expect(calls[0]?.[10]).toEqual({}); // openaiCompatHeaders resolve to empty, not an error

            // The refresh still succeeded, so its completion feedback fires.
            await vi.waitFor(() => {
                expect(Notice).toHaveBeenCalledWith('Model list refreshed');
            });
        });
    });

    describe('renderConnectionSettings (imperative path)', () => {
        const makeContainer = (): Record<string, unknown> => ({
            children: [] as unknown[],
            classList: { add: vi.fn(), remove: vi.fn() },
            createDiv: vi.fn().mockImplementation(() => makeContainer()),
            createEl: vi.fn().mockImplementation(() => makeContainer()),
            createSpan: vi.fn().mockImplementation(() => makeContainer()),
            empty: vi.fn()
        });

        const collectSettingNames = (plugin: IVaultIntelligencePlugin): string[] => {
            const names: string[] = [];
            const nameSpy = vi.spyOn(Setting.prototype, 'setName').mockImplementation(function (this: Setting, name: string | DocumentFragment) {
                if (typeof name === 'string') names.push(name);
                return this;
            });
            try {
                renderConnectionSettings({
                    app: plugin.app,
                    container: makeContainer(),
                    containerEl: makeContainer(),
                    plugin
                } as unknown as SettingsTabContext);
            } finally {
                nameSpy.mockRestore();
            }
            return names;
        };

        it('renders each API key field directly under its endpoint and before the next endpoint (legacy order)', () => {
            const plugin = makePlugin({
                ollamaEndpoint: CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT,
                openaiCompatEndpoint: CONNECTION_PRESETS.KILO.ENDPOINT
            });

            const names = collectSettingNames(plugin);
            const indexOf = (name: string) => names.indexOf(name);

            // The headers editors are custom rows without a Setting name, so the
            // named order pins: endpoint → key → (headers) → endpoint → key.
            expect(indexOf('Ollama endpoint')).toBeLessThan(indexOf('Ollama Cloud API key'));
            expect(indexOf('Ollama Cloud API key')).toBeLessThan(indexOf('OpenAI-compatible endpoint'));
            expect(indexOf('OpenAI-compatible endpoint')).toBeLessThan(indexOf('Kilo API key'));
        });

        it('omits the preset-governed API key fields for other endpoints (legacy visibility)', () => {
            const names = collectSettingNames(makePlugin({}));

            expect(names).not.toContain('Ollama Cloud API key');
            expect(names).not.toContain('Kilo API key');
            expect(names).toContain('Ollama endpoint');
            expect(names).toContain('OpenAI-compatible endpoint');
        });
    });

    describe('configureRefreshModelListField', () => {
        it('should refresh through the shared helper, notice, and rebuild the UI', async () => {
            // A Google-less, Ollama-only setup must be enough to enable the button.
            const plugin = makePlugin({ ollamaEndpoint: 'https://ollama.com' });
            const update = vi.fn();
            const context = { tabInstance: { update } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureRefreshModelListField(setting as unknown as Setting, plugin, context);

            expect(setting.desc).toBe(
                'Force a fresh fetch of available models from the Gemini API, your Ollama server, and any OpenAI-compatible endpoint.'
            );
            expect(setting.buttonComponents[0]?.setDisabled).toHaveBeenCalledWith(false);

            await setting.fireButton();

            expect(vi.mocked(ModelRegistry.fetchModels)).toHaveBeenCalledOnce();
            expect(Notice).toHaveBeenCalledWith('Model list refreshed');
            expect(update).toHaveBeenCalledOnce();
        });

        it('should surface fetch failures as a failure notice', async () => {
            vi.mocked(ModelRegistry.fetchModels).mockRejectedValueOnce(new Error('boom'));
            const plugin = makePlugin({ ollamaEndpoint: 'https://ollama.com' });
            const update = vi.fn();
            const context = { tabInstance: { update } } as unknown as SettingsTabContext;
            const setting = new MockSetting();

            configureRefreshModelListField(setting as unknown as Setting, plugin, context);
            await setting.fireButton();

            expect(Notice).toHaveBeenCalledWith('Failed to refresh models: boom');
        });

        it('should disable the button when no connection is configured', async () => {
            const plugin = makePlugin({});
            const setting = new MockSetting();

            configureRefreshModelListField(setting as unknown as Setting, plugin, {} as SettingsTabContext);

            expect(setting.buttonComponents[0]?.setDisabled).toHaveBeenCalledWith(true);
            expect(vi.mocked(ModelRegistry.fetchModels)).not.toHaveBeenCalled();
        });

        it('should keep the Google-key-only setup enabled', async () => {
            const plugin = makePlugin({ googleApiKey: 'google-key' });
            const setting = new MockSetting();

            configureRefreshModelListField(setting as unknown as Setting, plugin, {} as SettingsTabContext);

            expect(setting.buttonComponents[0]?.setDisabled).toHaveBeenCalledWith(false);
        });
    });

    describe('refreshModelList', () => {
        it('should resolve both connections\u2019 headers and force an update', async () => {
            const plugin = makePlugin({
                ollamaHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' }),
                openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });

            await refreshModelList(plugin, { tolerateMissingSecrets: true });

            const calls = vi.mocked(ModelRegistry.fetchModels).mock.calls;
            expect(calls[0]?.[4]).toBe(0);
            expect(calls[0]?.[5]).toBe(true);
            expect(calls[0]?.[8]).toEqual({ Authorization: 'token123' });
            expect(calls[0]?.[10]).toEqual({ Authorization: 'token123' });
        });

        it('should proceed with a static Gemini fallback when no Google API key exists', async () => {
            const plugin = makePlugin({});
            (plugin.geminiService.getApiKey as Mock).mockResolvedValue('');

            await expect(refreshModelList(plugin)).resolves.toBeUndefined();

            expect(vi.mocked(ModelRegistry.fetchModels)).toHaveBeenCalledOnce();
        });

        it('should refuse to refresh when requireGoogleApiKey is set and the key is missing', async () => {
            const plugin = makePlugin({});
            (plugin.geminiService.getApiKey as Mock).mockResolvedValue('');

            await expect(refreshModelList(plugin, { requireGoogleApiKey: true })).rejects.toThrow('API key not found.');
            expect(vi.mocked(ModelRegistry.fetchModels)).not.toHaveBeenCalled();
        });

        it('should fail loudly on a missing stored secret by default', async () => {
            const plugin = makePlugin({
                ollamaHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });
            secrets?.getSecret.mockResolvedValue(null);

            await expect(refreshModelList(plugin)).rejects.toThrow('Missing secret for Authorization');
            expect(vi.mocked(ModelRegistry.fetchModels)).not.toHaveBeenCalled();
        });

        it('should tolerate missing stored header secrets when tolerateMissingSecrets is set', async () => {
            const plugin = makePlugin({
                ollamaHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });
            secrets?.getSecret.mockResolvedValue(null);

            await refreshModelList(plugin, { tolerateMissingSecrets: true });

            const calls = vi.mocked(ModelRegistry.fetchModels).mock.calls;
            expect(calls[0]?.[8]).toEqual({});
        });

        it('should fall back to the vault config dir when the manifest has no dir', async () => {
            const plugin = makePlugin({});
            plugin.manifest.dir = undefined;

            await refreshModelList(plugin);

            const calls = vi.mocked(ModelRegistry.fetchModels).mock.calls;
            expect(calls[0]?.[1]).toBe('mock-config-dir/plugins/vault-intelligence');
        });
    });
});