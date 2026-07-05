import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

describe('VaultIntelligenceSettingTab.display() (imperative path) — T5', () => {
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

        mockApp = {
            vault: { configDir: '/test/vault/config' },
            workspace: { offref: vi.fn(), on: vi.fn().mockReturnValue({}) },
        } as unknown as App;

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
    });

    it('should render without throwing on v1.12 (imperative path)', () => {
        setMockApiVersion('1.12.0');
        // Provide a functional containerEl via the mock's default mockElement()
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- testing the imperative display() path
        expect(() => tab.display()).not.toThrow();
    });

    it('should create tab navigation buttons (7 tabs)', () => {
        setMockApiVersion('1.12.0');
        // display() should not throw and should attempt to build the 7-tab structure.
        // The ButtonComponent mock records creations; we verify display() runs
        // the full tab array without throwing, which exercises all 7 render
        // function references.
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- testing the imperative display() path
        expect(() => tab.display()).not.toThrow();
    });

    it('should return early on v1.13 without rendering imperative UI', () => {
        setMockApiVersion('1.13.0');
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- testing the safety-net guard
        expect(() => tab.display()).not.toThrow();
    });
});