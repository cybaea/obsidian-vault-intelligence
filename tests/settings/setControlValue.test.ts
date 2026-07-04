import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

describe('VaultIntelligenceSettingTab.setControlValue', () => {
    let tab: VaultIntelligenceSettingTab;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;

    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.13.0');

        mockSettings = {
            chatModel: 'gemini-flash-latest',
            embeddingDimension: 768,
            embeddingModel: 'gemini-embedding-001',
            embeddingProvider: 'gemini',
        } as unknown as VaultIntelligenceSettings;

        mockApp = {} as unknown as App;

        mockPlugin = {
            app: mockApp,
            requiresIndexWipeOnExit: false,
            requiresWorkerRestartOnExit: false,
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;

        tab = new VaultIntelligenceSettingTab(mockApp, mockPlugin);
    });

    it('should reject unknown keys without mutation or save', async () => {
        const originalSettings = { ...mockSettings };
        await tab.setControlValue('nonExistentKey', 'someValue');

        expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
        expect(mockSettings).toEqual(originalSettings);
    });

    it('should accept known keys and persist via saveSettings', async () => {
        await tab.setControlValue('embeddingDimension', 1024);

        expect(mockSettings.embeddingDimension).toBe(1024);
        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(false);
    });

    it('should set requiresIndexWipeOnExit when embeddingProvider changes', async () => {
        await tab.setControlValue('embeddingProvider', 'ollama');

        expect(mockPlugin.requiresIndexWipeOnExit).toBe(true);
        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(false);
    });

    it('should set requiresIndexWipeOnExit when embeddingModel changes', async () => {
        await tab.setControlValue('embeddingModel', 'text-embedding-004');

        expect(mockPlugin.requiresIndexWipeOnExit).toBe(true);
        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(false);
    });

    it('should set requiresWorkerRestartOnExit and call saveSettings(true) when chatModel changes', async () => {
        await tab.setControlValue('chatModel', 'gemini-pro');

        expect(mockPlugin.requiresWorkerRestartOnExit).toBe(true);
        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(true);
    });

    it('should call saveSettings(false) for non-intercepted keys', async () => {
        await tab.setControlValue('embeddingDimension', 1024);

        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(false);
        expect(mockPlugin.requiresIndexWipeOnExit).toBe(false);
        expect(mockPlugin.requiresWorkerRestartOnExit).toBe(false);
    });

    it('should not trigger flag interception for unchanged values', async () => {
        const currentModel = mockSettings.chatModel;
        await tab.setControlValue('chatModel', currentModel);

        expect(mockPlugin.requiresWorkerRestartOnExit).toBe(false);
        expect(mockPlugin.saveSettings).toHaveBeenCalledWith(false);
    });
});