import { Setting } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export function renderIndexingSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Indexing and search').setHeading();

    new Setting(containerEl).setName('Indexing and search').setHeading();

    new Setting(containerEl)
        .setName('Minimum similarity score')
        .setDesc('Only notes with a similarity score above this threshold will be shown.')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.minSimilarityScore)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.minSimilarityScore = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Similar notes limit')
        .setDesc('Maximum number of similar notes to show in the sidebar.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.similarNotesLimit))
            .setValue(String(plugin.settings.similarNotesLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.similarNotesLimit = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Vault search results limit')
        .setDesc('Maximum number of results returned by the vault search tool.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.vaultSearchResultsLimit))
            .setValue(String(plugin.settings.vaultSearchResultsLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.vaultSearchResultsLimit = num;
                    await plugin.saveSettings();
                }
            }));
}