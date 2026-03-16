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
});
