import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';

describe('VaultIntelligenceSettingTab.getControlValue', () => {
    let tab: VaultIntelligenceSettingTab;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            chatModel: 'gemini-flash-latest',
            embeddingModel: 'gemini-embedding-001',
        } as unknown as VaultIntelligenceSettings;

        mockApp = {} as unknown as App;

        mockPlugin = {
            app: mockApp,
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;

        tab = new VaultIntelligenceSettingTab(mockApp, mockPlugin);
    });

    it('should return the correct value for known keys', () => {
        expect(tab.getControlValue('chatModel')).toBe('gemini-flash-latest');
        expect(tab.getControlValue('embeddingModel')).toBe('gemini-embedding-001');
    });

    it('should return undefined for unknown keys', () => {
        expect(tab.getControlValue('nonExistentKey')).toBeUndefined();
    });
});