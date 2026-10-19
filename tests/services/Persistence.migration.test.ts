import { App, PluginManifest } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import VaultIntelligencePlugin from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings/types';

describe('Persistence Migration (Tiered Context Controls)', () => {
    it('should rescue legacy local contexts into modelContextOverrides', async () => {
        // Mock the environment
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '8.2.0' } as PluginManifest;

        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);
        
        const legacyData = {
            chatModel: 'ollama/llama3',
            contextWindowTokens: 16000,
            gardenerContextBudget: 32000,
            gardenerModel: 'local/qwen2',
            modelContextOverrides: {}
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        // Check if legacy budgets got rescued
        expect(plugin.settings.modelContextOverrides['ollama/llama3']).toBe(16000);
        expect(plugin.settings.modelContextOverrides['local/qwen2']).toBe(32000);

        // Check if global settings got reset to safe defaults
        expect(plugin.settings.contextWindowTokens).toBe(DEFAULT_SETTINGS.contextWindowTokens);
        expect(plugin.settings.gardenerContextBudget).toBe(DEFAULT_SETTINGS.gardenerContextBudget);
    });

    it('should sanitize out-of-bounds user overrides', async () => {
        // Mock the environment
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '8.2.0' } as PluginManifest;

        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);
        
        const dirtyData = {
            chatModel: 'gemini-1.5-flash',
            contextWindowTokens: 200000,
            modelContextOverrides: {
                'local/broken': -50,
                'ollama/tinyllama': 9999999
            }
        };

        plugin.loadData = vi.fn().mockResolvedValue(dirtyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        // ModelRegistry.getModelById internally is checked by sanitizeBudgets
        // It should cap things properly
        await plugin.loadSettings();

        // Assume default max token sanity or ModelRegistry fetch result limit kicks in
        expect(plugin.settings.modelContextOverrides['local/broken']).toBeGreaterThanOrEqual(1024); // MIN_TOKEN_LIMIT
        
        // 9999999 should be capped. If model is unknown, default max sanity is used (1048576)
        expect(plugin.settings.modelContextOverrides['ollama/tinyllama']).toBeLessThanOrEqual(1048576); 
    });

    it('should migrate gardenerRecheckHours to gardenerRecheckDays and remove legacy key', async () => {
        // Mock the environment
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '8.1.0' } as PluginManifest;

        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);
        
        const legacyData = {
            gardenerRecheckHours: 48,
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);
        plugin.saveSettings = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        // Check if migration happened
        expect(plugin.settings.gardenerRecheckDays).toBe(2);
        
        // Use any to check for non-existent key in type
        expect((plugin.settings as unknown as Record<string, unknown>)['gardenerRecheckHours']).toBeUndefined();
    });

    it('should migrate legacy secret ID references into googleApiKeySecret', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '8.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        const legacyData = {
            googleApiKey: 'vault-intelligence-api-key',
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveSettings = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        expect(plugin.settings.googleApiKeySecret).toBe('vault-intelligence-api-key');
        expect(plugin.settings.googleApiKey).toBe('');
    });

    it('should normalise legacy double-prefixed secret references', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '9.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        const legacyData = {
            mcpServers: [{
                env: '{"API_KEY": "vi-secret:mcp-server1-env-API_KEY"}',
                id: 'server1',
                name: 'Test server',
                remoteHeaders: '{"Authorization": "vi-secret:mcp-server1-headers-Authorization"}',
                requireExplicitConfirmation: true,
                type: 'streamable_http'
            }],
            ollamaHeaders: '{"Authorization": "vi-secret:ollama-headers-Authorization"}'
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        // Resolvers prepend the namespace prefix at lookup time, so references
        // must store the bare key for the stored secrets to resolve — and the
        // key must be an id SecretStorage accepts (lowercase letters, numbers,
        // and dashes only). The sanitiser parses and re-serialises the map, so
        // rewritten maps come back in canonical compact JSON.
        expect(plugin.settings.ollamaHeaders).toBe('{"Authorization":"vi-secret:authorization"}');
        expect(plugin.settings.mcpServers[0]?.env).toBe('{"API_KEY":"vi-secret:api-key"}');
        expect(plugin.settings.mcpServers[0]?.remoteHeaders).toBe('{"Authorization":"vi-secret:authorization"}');
        expect(plugin.saveData).toHaveBeenCalled();
    });

    it('should copy a legacy keychain secret across while sanitising references', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '9.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        // Simulate a keychain that already holds the secret under a legacy id
        // (possible on Obsidian builds older than the id validation): the
        // value must be copied to the sanitised id so the rewritten reference
        // keeps resolving.
        const setSecret = vi.fn();
        (plugin.app as unknown as { secretStorage: unknown }).secretStorage = {
            getSecret: (id: string) => (id === 'ollama-headers-Authorization' ? 'Bearer legacy' : null),
            setSecret
        };

        const legacyData = {
            ollamaHeaders: '{"Authorization": "vi-secret:Authorization"}'
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        expect(plugin.settings.ollamaHeaders).toBe('{"Authorization":"vi-secret:authorization"}');
        expect(setSecret).toHaveBeenCalledWith('ollama-headers-authorization', 'Bearer legacy');
    });

    it('should keep the legacy reference when the legacy secret exists but cannot be copied', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '9.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        const setSecret = vi.fn(() => {
            throw new Error('Secure storage is not available.');
        });
        (plugin.app as unknown as { secretStorage: unknown }).secretStorage = {
            getSecret: (id: string) => (id === 'ollama-headers-Authorization' ? 'Bearer legacy' : null),
            setSecret
        };

        const legacyData = {
            ollamaHeaders: '{"Authorization": "vi-secret:Authorization"}'
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        // A working legacy setup must not be broken by a failed copy.
        expect(plugin.settings.ollamaHeaders).toBe('{"Authorization": "vi-secret:Authorization"}');
        expect(setSecret).toHaveBeenCalled();
    });

    it('should rewrite references carrying SecretStorage-hostile payloads on their own', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '9.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        const legacyData = {
            ollamaHeaders: '{"Authorization": "vi-secret:Authorization"}'
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        // The mixed-case payload could never have been stored (SecretStorage
        // rejects such ids), so the rewrite is safe without any copy.
        expect(plugin.settings.ollamaHeaders).toBe('{"Authorization":"vi-secret:authorization"}');
        expect(plugin.saveData).toHaveBeenCalled();
    });

    it('should leave already-valid secret references untouched', async () => {
        const mockApp = new App();
        const mockManifest = { id: 'obsidian-vault-intelligence', version: '9.5.0' } as PluginManifest;
        const plugin = new VaultIntelligencePlugin(mockApp, mockManifest);

        const legacyData = {
            ollamaHeaders: '{"Authorization": "vi-secret:authorization"}'
        };

        plugin.loadData = vi.fn().mockResolvedValue(legacyData);
        plugin.saveData = vi.fn().mockResolvedValue(undefined);

        await plugin.loadSettings();

        expect(plugin.settings.ollamaHeaders).toBe('{"Authorization": "vi-secret:authorization"}');
    });
});
