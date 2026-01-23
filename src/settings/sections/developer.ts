import { Setting, Notice } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";
import { LogLevel, logger } from "../../utils/logger";
import { ModelRegistry } from "../../services/ModelRegistry";

export function renderDeveloperSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Developer').setHeading();

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

    new Setting(containerEl)
        .setName('Debug model list')
        .setDesc('Log the full response from the last Gemini model fetch to the developer console.')
        .addButton(btn => btn
            .setButtonText("Log items")
            .setIcon('terminal')
            .onClick(() => {
                void (async () => {
                    let raw = ModelRegistry.getRawResponse();

                    if (!raw && plugin.settings.googleApiKey) {
                        btn.setDisabled(true);
                        btn.setButtonText("Fetching...");
                        new Notice("Fetching fresh model data...");
                        try {
                            // Force bypass cache (duration = 0) to ensure we get rawResponse even if models were cached
                            await ModelRegistry.fetchModels(plugin.app, plugin.settings.googleApiKey, 0);
                            raw = ModelRegistry.getRawResponse();
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            new Notice(`Failed to fetch model list: ${msg}`);
                        } finally {
                            btn.setDisabled(false);
                            btn.setButtonText("Log items");
                            btn.setIcon('terminal');
                        }
                    }

                    if (raw) {
                        logger.debug("Gemini models response:", raw);
                        new Notice("JSON logged to console (Ctrl+Shift+I)");
                    } else if (!plugin.settings.googleApiKey) {
                        new Notice("No API key configured. Enter one in 'connection' first.");
                    } else {
                        new Notice("No model data available. The fetch failed.");
                    }
                })();
            }));
}
