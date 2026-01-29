import { App } from "obsidian";

import { IVaultIntelligencePlugin } from "./types";

/**
 * Context object passed to settings tab render functions
 * Provides access to app, plugin, and the container element for the tab
 */
export interface SettingsTabContext {
    app: App;
    containerEl: HTMLElement;
    plugin: IVaultIntelligencePlugin;
}
