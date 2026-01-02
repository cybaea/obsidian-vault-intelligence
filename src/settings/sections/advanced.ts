import { Setting } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { LogLevel } from "../../utils/logger"; 

export function renderAdvancedSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Advanced').setHeading();

    // --- NEW: Max Agent Steps ---
    new Setting(containerEl)
        .setName('Max agent steps')
        .setDesc(`The maximum number of reasoning loops (thinking steps) the agent is allowed to take. (Default: ${DEFAULT_SETTINGS.maxAgentSteps})`)
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.maxAgentSteps))
            .setValue(String(plugin.settings.maxAgentSteps))
            .onChange(async (value) => {
                const num = parseInt(value);
                // Ensure it's a valid number and at least 1
                if (!isNaN(num) && num >= 1) {
                    plugin.settings.maxAgentSteps = num;
                    await plugin.saveSettings();
                }
            }));

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