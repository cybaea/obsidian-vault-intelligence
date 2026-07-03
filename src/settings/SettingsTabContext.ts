import type { App } from "obsidian";

import type { VaultIntelligenceSettingTab } from "./settingsTab";
import type { IVaultIntelligencePlugin } from "./types";

/**
 * Context object passed to settings tab render functions
 * Provides access to app, plugin, the container element for the tab, and
 * an optional reference to the parent setting tab instance for version-gated
 * UI refresh (see refreshSettings/reRenderSection).
 */
export interface SettingsTabContext {
    app: App;
    containerEl: HTMLElement;
    plugin: IVaultIntelligencePlugin;
    tabInstance?: VaultIntelligenceSettingTab;
}
