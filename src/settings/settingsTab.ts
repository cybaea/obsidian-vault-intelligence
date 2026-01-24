import { App, PluginSettingTab, Plugin } from "obsidian";
import { IVaultIntelligencePlugin } from "./types";
import { renderConnectionSettings } from "./sections/connections";
import { renderResearcherSettings } from "./sections/researcher";
import { renderExplorerSettings } from "./sections/explorer";
import { renderGardenerSettings } from "./sections/gardener";
import { renderAdvancedSettings } from "./sections/advanced";

export class VaultIntelligenceSettingTab extends PluginSettingTab {
    plugin: IVaultIntelligencePlugin;

    constructor(app: App, plugin: IVaultIntelligencePlugin) {
        // We cast to 'Plugin' because the parent class expects the strict Obsidian Plugin type,
        // but we know our interface is compatible at runtime.
        super(app, plugin as unknown as Plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        renderConnectionSettings(containerEl, this.plugin);
        renderResearcherSettings(containerEl, this.plugin);
        renderExplorerSettings(containerEl, this.plugin);
        renderGardenerSettings(containerEl, this.plugin);
        renderAdvancedSettings(containerEl, this.plugin);
    }
}
