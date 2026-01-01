import { Setting } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export function renderModelSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    // FIX: Change 'AI Models' to sentence case 'AI models'
    new Setting(containerEl).setName('AI models').setHeading();

    new Setting(containerEl)
        .setName('Chat model')
        .setDesc('The model to use for chat and research.')
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.chatModel)
            .setValue(plugin.settings.chatModel)
            .onChange(async (value) => {
                plugin.settings.chatModel = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Embedding model')
        .setDesc('The model to use for generating vector embeddings.')
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
            .setValue(plugin.settings.embeddingModel)
            .onChange(async (value) => {
                plugin.settings.embeddingModel = value;
                await plugin.saveSettings();
            }));
}