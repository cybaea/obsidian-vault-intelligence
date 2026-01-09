import { Setting, Notice } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
import { LogLevel } from "../../utils/logger";

export function renderAdvancedSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Advanced').setHeading();

    new Setting(containerEl)
        .setName('System instruction')
        .setDesc('Defines the behavior and persona of the agent. Use {{DATE}} to insert the current date.')
        .setClass('vault-intelligence-system-instruction-setting') // Critical for the CSS fix
        .addTextArea(text => {
            text
                .setPlaceholder(DEFAULT_SETTINGS.systemInstruction)
                .setValue(plugin.settings.systemInstruction)
                .onChange(async (value) => {
                    plugin.settings.systemInstruction = value;
                    await plugin.saveSettings();
                });

            text.inputEl.rows = 10;
        });

    new Setting(containerEl)
        .setName('Max agent steps')
        // ... (rest of the file remains the same)
        .setDesc(`The maximum number of reasoning loops (thinking steps) the agent is allowed to take. (Default: ${DEFAULT_SETTINGS.maxAgentSteps})`)
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.maxAgentSteps))
            .setValue(String(plugin.settings.maxAgentSteps))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 1) {
                    plugin.settings.maxAgentSteps = num;
                    await plugin.saveSettings();
                }
            }));

    if (plugin.settings.embeddingProvider === 'gemini') {
        new Setting(containerEl)
            .setName('Embedding dimension')
            .setDesc('The vector size for your embeddings. Gemini supports 768, 1536, or 3072. Changing this will wipe your index and cost API credits to rebuild.')
            .addDropdown(dropdown => dropdown
                .addOption('768', '768 (standard)')
                .addOption('1536', '1536 (high detail)')
                .addOption('3072', '3072 (max detail)')
                .setValue(String(plugin.settings.embeddingDimension))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (num !== plugin.settings.embeddingDimension) {
                        plugin.settings.embeddingDimension = num;
                        await plugin.saveSettings();
                        new Notice("Embedding dimension changed. Re-indexing vault...");
                        await plugin.vectorStore.reindexVault();
                    }
                }));
    } else {
        // Local Threading Settings
        new Setting(containerEl)
            .setName('Local embedding threads')
            .setDesc('Number of threads to use for local embedding. More threads are faster but use more memory.')
            .addSlider(slider => slider
                .setLimits(1, 4, 1)
                .setValue(plugin.settings.embeddingThreads)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    plugin.settings.embeddingThreads = value;
                    await plugin.saveSettings();

                    // Surgical update without restart
                    if (plugin.embeddingService.updateConfiguration) {
                        plugin.embeddingService.updateConfiguration();
                    }
                }));
    }

    new Setting(containerEl)
        .setName('Gemini retries')
        .setDesc('Number of times to retry a Gemini API call if it fails.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.geminiRetries))
            .setValue(String(plugin.settings.geminiRetries))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.geminiRetries = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Log level')
        .setDesc('Level of detail for logs in the developer console.')
        .addDropdown(dropdown => dropdown
            .addOption(String(LogLevel.DEBUG), 'Debug')
            .addOption(String(LogLevel.INFO), 'Info')
            .addOption(String(LogLevel.WARN), 'Warn')
            .addOption(String(LogLevel.ERROR), 'Error')
            .setValue(String(plugin.settings.logLevel))
            .onChange(async (value) => {
                plugin.settings.logLevel = parseInt(value) as LogLevel;
                await plugin.saveSettings();
            }));
}