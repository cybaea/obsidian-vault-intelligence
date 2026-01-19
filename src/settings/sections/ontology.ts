import { Setting, Notice } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";

/**
 * Renders the Ontology settings section.
 * @param containerEl - The container element to render into.
 * @param plugin - The plugin instance.
 */
export function renderOntologySettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Ontology').setHeading();

    new Setting(containerEl)
        .setName('Ontology path')
        .setDesc('Specify the folder where your ontology (concepts, entities, MOCs) is stored.')
        .addText(text => text
            .setPlaceholder('Ontology')
            .setValue(plugin.settings.ontologyPath)
            .onChange(async (value) => {
                plugin.settings.ontologyPath = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Gardener plans path')
        .setDesc('Specify the folder where the gardener should save its plans.')
        .addText(text => text
            .setPlaceholder('Gardener plans')
            .setValue(plugin.settings.gardenerPlansPath)
            .onChange(async (value) => {
                plugin.settings.gardenerPlansPath = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName("Plans retention (days)")
        .setDesc('How many days to keep gardener plans before purging them.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.plansRetentionDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.plansRetentionDays = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for retention days.");
                }
            }));

    new Setting(containerEl)
        .setName("Gardener analysis limit")
        .setDesc('Maximum number of recent notes to scan for hygiene improvements.')
        .addText(text => text
            .setPlaceholder('50')
            .setValue(String(plugin.settings.gardenerNoteLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerNoteLimit = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for the analysis limit.");
                }
            }));

    new Setting(containerEl)
        .setName("Skip retention (days)")
        .setDesc('How many days to remember that you skipped/rejected a file before investigating it again.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.gardenerSkipRetentionDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerSkipRetentionDays = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for skip retention.");
                }
            }));

    new Setting(containerEl)
        .setName('Excluded folders')
        .setDesc('Comma-separated list of folders the gardener should ignore.')
        .addTextArea(text => text
            .setPlaceholder('Templates, archive, ontology')
            .setValue(plugin.settings.excludedFolders.join(', '))
            .onChange(async (value) => {
                plugin.settings.excludedFolders = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                await plugin.saveSettings();
            }));
}
