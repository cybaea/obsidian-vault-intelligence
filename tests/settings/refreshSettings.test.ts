import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reRenderSection, refreshSettings } from '../../src/settings/refreshSettings';
import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { SettingsTabContext } from '../../src/settings/SettingsTabContext';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

describe('refreshSettings', () => {
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;
    let context: SettingsTabContext;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {} as unknown as VaultIntelligenceSettings;
        mockApp = {} as unknown as App;

        mockPlugin = {
            app: mockApp,
            manifest: { id: 'vault-intelligence' },
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;

        context = {
            app: mockApp,
            containerEl: { empty: vi.fn() } as unknown as HTMLElement,
            plugin: mockPlugin,
        };
    });

    it('should call tabInstance.update() when v1.13+ is available', () => {
        setMockApiVersion('1.13.0');
        const updateSpy = vi.fn();
        context.tabInstance = { update: updateSpy } as unknown as VaultIntelligenceSettingTab;

        refreshSettings(context);

        expect(updateSpy).toHaveBeenCalledOnce();
    });

    it('should fall back to openTabById when v1.13+ is not available', () => {
        setMockApiVersion('1.12.0');
        const openTabById = vi.fn();
        mockPlugin.app = {
            setting: { openTabById },
        } as unknown as App;

        refreshSettings(context);

        expect(openTabById).toHaveBeenCalledWith('vault-intelligence');
    });
});

describe('reRenderSection', () => {
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;
    let mockApp: App;
    let context: SettingsTabContext;
    let mockContainerEl: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {} as unknown as VaultIntelligenceSettings;
        mockApp = {} as unknown as App;

        mockPlugin = {
            app: mockApp,
            manifest: { id: 'vault-intelligence' },
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settings: mockSettings,
        } as unknown as IVaultIntelligencePlugin;

        mockContainerEl = {
            empty: vi.fn(),
        } as unknown as HTMLElement;

        context = {
            app: mockApp,
            containerEl: mockContainerEl,
            plugin: mockPlugin,
        };
    });

    it('should call tabInstance.update() when v1.13+ is available', () => {
        setMockApiVersion('1.13.0');
        const updateSpy = vi.fn();
        context.tabInstance = { update: updateSpy } as unknown as VaultIntelligenceSettingTab;
        const renderFn = vi.fn();

        reRenderSection(context, renderFn);

        expect(updateSpy).toHaveBeenCalledOnce();
        expect(renderFn).not.toHaveBeenCalled();
    });

    it('should empty container and re-call render function when v1.13+ is not available', () => {
        setMockApiVersion('1.12.0');
        const renderFn = vi.fn();

        reRenderSection(context, renderFn);

        expect(mockContainerEl.empty).toHaveBeenCalledOnce();
        expect(renderFn).toHaveBeenCalledWith(context);
    });
});