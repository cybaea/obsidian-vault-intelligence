import { Setting } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { LogLevel } from "../../utils/logger";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS } from "../types";

export function renderAdvancedSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const gemini = "Gemini";
    const api = "API";
    const local = "Local";

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Technical tuning and system-level configurations.');
    });

    // --- 1. Indexing Performance ---
    new Setting(containerEl)
        .setName('Performance')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Technical tuning for background indexing. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

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
        .setName('Indexing throttle (ms)')
        .setDesc('Delay between files during indexing to respect API rate limits.')
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
        const maxThreads = Math.max(4, navigator.hardwareConcurrency || 4);
        new Setting(containerEl)
            .setName(`${local} worker threads`)
            .setDesc(`CPU threads used for ${local.toLowerCase()} embeddings. Higher is faster but heavier.`)
            .addSlider(slider => {
                slider
                    .setLimits(1, maxThreads, 1)
                    .setValue(plugin.settings.embeddingThreads)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        plugin.settings.embeddingThreads = value;
                        await plugin.saveSettings();
                        if (plugin.embeddingService.updateConfiguration) {
                            plugin.embeddingService.updateConfiguration();
                        }
                    });
            });
    }

    // --- 2. System and API ---
    new Setting(containerEl)
        .setName(`System and ${api}`)
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'System-level settings and API connection tuning. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

    new Setting(containerEl)
        .setName(`${gemini} API retries`)
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

    // --- 3. Search Relevance (GARS Tuning) ---
    new Setting(containerEl)
        .setName('Search relevance tuning')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Adjust weights for the proprietary graph-aware scoring engine. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });

    containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Adjust the weights used to calculate the graph-aware relevance score. The total does not have to be 1.0, as scores are compared relatively.'
    });

    const garsReset = () => {
        plugin.settings.garsSimilarityWeight = DEFAULT_SETTINGS.garsSimilarityWeight;
        plugin.settings.garsCentralityWeight = DEFAULT_SETTINGS.garsCentralityWeight;
        plugin.settings.garsActivationWeight = DEFAULT_SETTINGS.garsActivationWeight;
    };

    new Setting(containerEl)
        .setName('Similarity weight')
        .setDesc('How much weight to give to vector/keyword match similarity.')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.garsSimilarityWeight)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.garsSimilarityWeight = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.garsSimilarityWeight.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.garsSimilarityWeight = DEFAULT_SETTINGS.garsSimilarityWeight;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Centrality weight')
        .setDesc('How much weight to give to the structural importance of a note.')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.garsCentralityWeight)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.garsCentralityWeight = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.garsCentralityWeight.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.garsCentralityWeight = DEFAULT_SETTINGS.garsCentralityWeight;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Activation weight')
        .setDesc('How much weight to give to spreading activation (connectedness to other hits).')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.garsActivationWeight)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.garsActivationWeight = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.garsActivationWeight.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.garsActivationWeight = DEFAULT_SETTINGS.garsActivationWeight;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Reset weights')
        .setDesc('Restore all weights to their default balanced values.')
        .addButton(btn => btn
            .setButtonText('Restore defaults')
            .onClick(async () => {
                garsReset();
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    // --- 4. Search and Context Tuning ---
    new Setting(containerEl)
        .setName('Search and context tuning')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Tune how search expands results and assembles context. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });

    containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Adjust search result expansion and context assembly.'
    });

    const tuningReset = () => {
        plugin.settings.searchExpansionSeedsLimit = DEFAULT_SETTINGS.searchExpansionSeedsLimit;
        plugin.settings.searchExpansionThreshold = DEFAULT_SETTINGS.searchExpansionThreshold;
        plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
        plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
        plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
        plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
    };

    new Setting(containerEl)
        .setName('Max expansion seeds')
        .setDesc('Capped number of results that trigger graph neighbor expansion. Prevents performance lag.')
        .addSlider(slider => slider
            .setLimits(1, 20, 1)
            .setValue(plugin.settings.searchExpansionSeedsLimit)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.searchExpansionSeedsLimit = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.searchExpansionSeedsLimit})`)
            .onClick(async () => {
                plugin.settings.searchExpansionSeedsLimit = DEFAULT_SETTINGS.searchExpansionSeedsLimit;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Expansion gap threshold')
        .setDesc('Relative score gap (multiplier of top match) within which a result triggers neighbor expansion.')
        .addSlider(slider => slider
            .setLimits(0.1, 1.0, 0.05)
            .setValue(plugin.settings.searchExpansionThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.searchExpansionThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.searchExpansionThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.searchExpansionThreshold = DEFAULT_SETTINGS.searchExpansionThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Primary context threshold')
        .setDesc('Score relative to top match required for full file content inclusion.')
        .addSlider(slider => slider
            .setLimits(0.5, 0.99, 0.05)
            .setValue(plugin.settings.contextPrimaryThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextPrimaryThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextPrimaryThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Supporting context threshold')
        .setDesc('Score relative to top match required for snippet inclusion.')
        .addSlider(slider => slider
            .setLimits(0.1, 0.9, 0.05)
            .setValue(plugin.settings.contextSupportingThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextSupportingThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextSupportingThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Structural context threshold')
        .setDesc('Score relative to top match required for header inclusion. Below this, notes are skipped.')
        .addSlider(slider => slider
            .setLimits(0.01, 0.5, 0.02)
            .setValue(plugin.settings.contextStructuralThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextStructuralThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextStructuralThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Max context documents')
        .setDesc('Safety limit for total number of documents injected into context.')
        .addSlider(slider => slider
            .setLimits(5, 500, 5)
            .setValue(plugin.settings.contextMaxFiles)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextMaxFiles = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextMaxFiles})`)
            .onClick(async () => {
                plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Reset tuning')
        .setDesc('Restore all search and context tuning values to their defaults.')
        .addButton(btn => btn
            .setButtonText('Restore defaults')
            .onClick(async () => {
                tuningReset();
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    // --- 5. Developer and Debugging ---
    new Setting(containerEl)
        .setName('Developer')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Diagnostic tools and logging verbosity. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

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