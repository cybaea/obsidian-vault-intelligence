import { App, PluginSettingTab, Plugin } from "obsidian";
import { IVaultIntelligencePlugin } from "./types";
import { renderConnectionSettings } from "./sections/connections";
import { renderModelSettings } from "./sections/models";
import { renderIndexingSettings } from "./sections/indexing";
import { renderAdvancedSettings } from "./sections/advanced";
import { renderOntologySettings } from "./sections/ontology";
import { renderDeveloperSettings } from "./sections/developer";

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
        renderModelSettings(containerEl, this.plugin);
        renderIndexingSettings(containerEl, this.plugin);
        renderOntologySettings(containerEl, this.plugin);
        renderAdvancedSettings(containerEl, this.plugin);
        renderDeveloperSettings(containerEl, this.plugin);
    }
}
