import { Setting, Notice, Plugin, App } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";

// Define internal Obsidian types to avoid 'any'
interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderModelSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Models').setHeading();

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Specify the models to use for different tasks.');
    });

    // --- 1. Embedding Provider ---
    new Setting(containerEl)
        .setName('Embedding provider')
        .setDesc('Choose where your document vectors are calculated.')
        .addDropdown(dropdown => dropdown
            .addOption('gemini', 'Google Gemini')
            .addOption('local', 'Transformers.js (local)')
            .setValue(plugin.settings.embeddingProvider)
            .onChange(async (value) => {
                // Type cast safety
                plugin.settings.embeddingProvider = value as 'gemini' | 'local';
                
                // Set defaults based on provider to prevent mismatch errors
                if (value === 'local') {
                    plugin.settings.embeddingModel = 'local-all-minilm-l6-v2';
                    plugin.settings.embeddingDimension = 384;
                } else {
                    plugin.settings.embeddingModel = DEFAULT_SETTINGS.embeddingModel;
                    plugin.settings.embeddingDimension = DEFAULT_SETTINGS.embeddingDimension;
                }

                await plugin.saveSettings();
                
                // Force a refresh of the settings tab
                // Safe cast to typed internal app
                const app = plugin.app as InternalApp;
                const manifestId = (plugin as unknown as Plugin).manifest.id;
                app.setting.openTabById(manifestId);
                
                new Notice("Provider changed. You may need to restart the plugin for changes to fully take effect.");
            }));

    // --- 2. Embedding Model (Dynamic) ---
    const embeddingSetting = new Setting(containerEl)
        .setName('Embedding model')
        .setDesc(`The model used to generate vector embeddings (Dimensions: ${plugin.settings.embeddingDimension}).`);

    if (plugin.settings.embeddingProvider === 'gemini') {
        embeddingSetting.addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
            .setValue(plugin.settings.embeddingModel)
            .onChange(async (value) => {
                plugin.settings.embeddingModel = value;
                await plugin.saveSettings();
            }));
    } else {
        // Local - Read Only for now
        embeddingSetting.setDesc(`The model used to generate vector embeddings. Currently using standard MiniLM (384d).`)
        embeddingSetting.addText(text => text
            .setValue(plugin.settings.embeddingModel)
            .setDisabled(true));
    }

    // --- 3. Chat Model ---
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
    
    // ... (Context Window, Grounding, Code settings remain the same)
    
    // 3.a. Context Window Tokens
    new Setting(containerEl)
        .setName('Context window budget')
        .setDesc('Maximum tokens to use for context.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.contextWindowTokens))
            .setValue(String(plugin.settings.contextWindowTokens))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num > 0) {
                    plugin.settings.contextWindowTokens = num;
                    await plugin.saveSettings();
                }
            }));

    // 4. Grounding Model
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

    // 5. Code Model & Execution Toggle
    new Setting(containerEl)
        .setName('Enable code execution')
        .setDesc('Enable a specialized sub-agent that uses code to solve math problems and complex logic.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCodeExecution)
            .onChange(async (value) => {
                plugin.settings.enableCodeExecution = value;
                await plugin.saveSettings();
                
                // Refresh to show/hide code model
                const app = plugin.app as InternalApp;
                const manifestId = (plugin as unknown as Plugin).manifest.id;
                app.setting.openTabById(manifestId);
            }));

    if (plugin.settings.enableCodeExecution) {
        new Setting(containerEl)
            .setName('Code model')
            .setDesc(`The model used for code execution (e.g., \`${DEFAULT_SETTINGS.codeModel}\`).`)
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.codeModel)
                .setValue(plugin.settings.codeModel)
                .onChange(async (value) => {
                    plugin.settings.codeModel = value;
                    await plugin.saveSettings();
                }));
    }
}
