import { Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../types";
import { LogLevel } from "../../utils/logger";
import { ModelRegistry } from "../../services/ModelRegistry";
import { SettingsTabContext } from "../SettingsTabContext";

export function renderAdvancedSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const gemini = "Gemini";
    const api = "API";
    const local = "Local";

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Technical tuning and system-level configurations.');
    });

    // --- 1. Indexing Performance ---
    new Setting(containerEl).setName('Performance').setHeading();

    new Setting(containerEl)
        .setName('Indexing delay (ms)')
        .setDesc('Debounce delay for background indexing while typing.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.indexingDelayMs))
            .setValue(String(plugin.settings.indexingDelayMs))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num)) {
                    plugin.settings.indexingDelayMs = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Bulk scan delay (ms)')
        .setDesc('Delay between files during full vault scans.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.queueDelayMs))
            .setValue(String(plugin.settings.queueDelayMs))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num)) {
                    plugin.settings.queueDelayMs = num;
                    await plugin.saveSettings();
                }
            }));

    if (plugin.settings.embeddingProvider === 'local') {
        new Setting(containerEl)
            .setName(`${local} worker threads`)
            .setDesc(`CPU threads used for ${local.toLowerCase()} embeddings.Higher is faster but heavier.`)
            .addSlider(slider => slider
                .setLimits(1, 4, 1)
                .setValue(plugin.settings.embeddingThreads)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    plugin.settings.embeddingThreads = value;
                    await plugin.saveSettings();
                    if (plugin.embeddingService.updateConfiguration) {
                        plugin.embeddingService.updateConfiguration();
                    }
                }));
    }

    // --- 2. System and API ---
    new Setting(containerEl).setName(`System and ${api} `).setHeading();

    new Setting(containerEl)
        .setName(`${gemini} ${api} retries`)
        .setDesc('Number of retries for spotty connections.')
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
        .setName('Model cache duration (days)')
        .setDesc(`How long to cache available ${gemini} models locally.`)
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.modelCacheDurationDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.modelCacheDurationDays = num;
                    await plugin.saveSettings();
                }
            }));

    // --- 3. Developer and Debugging ---
    new Setting(containerEl).setName('Developer').setHeading();

    new Setting(containerEl)
        .setName('Log level')
        .setDesc('Console verbosity for debugging.')
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
        .setName('Full model list debug')
        .setDesc(`Log raw ${api} response for models to console.`)
        .addButton(btn => btn
            .setIcon('terminal')
            .onClick(async () => {
                let raw = ModelRegistry.getRawResponse();
                if (!raw && plugin.settings.googleApiKey) {
                    await ModelRegistry.fetchModels(plugin.app, plugin.settings.googleApiKey, 0);
                    raw = ModelRegistry.getRawResponse();
                }
                if (raw) {
                    console.debug("[VaultIntelligence] Raw models:", raw);
                }
            }));
}