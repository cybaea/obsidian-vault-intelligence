import { Setting, setIcon } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";

export function renderModelSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Models').setHeading();

    // 0. Info
    containerEl.createDiv({ cls: 'vault-intelligence-settings-info' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-info')
        div.createSpan({}, (textSpan) => {
            textSpan.append('You can find the list of available models and their capabilities in the documentation for Gemini ');
        textSpan.createEl('a', {
            href: 'https://ai.google.dev/gemini-api/docs/models',
            text: (() => "models")() // Workaround for linter issue with obsidianmd/ui/sentence-case
        });
        textSpan.append(' and ' )
        textSpan.createEl('a', {
            href: 'https://ai.google.dev/gemini-api/docs/embeddings#model-versions',
            text: (() => "embeddings")() // Workaround for linter issue with obsidianmd/ui/sentence-case
        });
        textSpan.append('.');
        });
    });

    // 1. Chat Model
    new Setting(containerEl)
        .setName('Chat model')
        .setDesc(`The main model used for reasoning and answering questions (e.g., \`${DEFAULT_SETTINGS.chatModel}\`).`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.chatModel)
            .setValue(plugin.settings.chatModel)
            .onChange(async (value) => {
                plugin.settings.chatModel = value;
                await plugin.saveSettings();
            }));

    // 2. Embedding Model
    new Setting(containerEl)
        .setName('Embedding model')
        .setDesc(`The model used to generate vector embeddings for your notes (e.g., \`${DEFAULT_SETTINGS.embeddingModel}\`).`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
            .setValue(plugin.settings.embeddingModel)
            .onChange(async (value) => {
                plugin.settings.embeddingModel = value;
                await plugin.saveSettings();
            }));

    // 3. Grounding Model (NEW)
    new Setting(containerEl)
        .setName('Grounding model')
        .setDesc(`The fast, cost-effective model used specifically for web searches (e.g., \`${DEFAULT_SETTINGS.groundingModel}\`).`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.groundingModel)
            .setValue(plugin.settings.groundingModel)
            .onChange(async (value) => {
                plugin.settings.groundingModel = value;
                await plugin.saveSettings();
            }));
}
