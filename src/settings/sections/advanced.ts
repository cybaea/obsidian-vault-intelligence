import { Setting, SettingGroup, setIcon } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { LogLevel, logger } from "../../utils/logger";
import { resolveSecrets } from "../../utils/secrets";
import { reRenderSection } from "../refreshSettings";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS } from "../types";

const voyage = "Voyage AI";
const gemini = "Gemini";
const api = "API";
const local = "Local";

// --- Performance group ---

/**
 * Indexing delay (ms) — debounce delay for background indexing.
 */
export function configureIndexingDelayField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Indexing delay (ms)')
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
            })
        );
}

/**
 * Indexing throttle (ms) — delay between files to respect API rate limits.
 */
export function configureIndexingThrottleField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Indexing throttle (ms)')
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
            })
        );
}

/**
 * Embedding chunk size dropdown — target size for vector chunks.
 * Changing this triggers a full vault re-embedding on exit.
 */
export function configureEmbeddingChunkSizeField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const chunkDesc = createFragment();
    chunkDesc.appendText('Target size for vector chunks. Higher values provide more context but risk API rejection if the text is dense (code/cjk).');
    chunkDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    setting.setName('Embedding chunk size')
        .setDesc(chunkDesc)
        .addDropdown(dropdown => dropdown
            .addOption('512', '512 (Standard / cjk max)')
            .addOption('1024', '1024 (High context / code max)')
            .addOption('1500', `1500 (${gemini} safe)`)
            .addOption('2048', `2048 (${gemini} english only)`)
            .addOption('4096', `4096 (${voyage} safe)`)
            .addOption('8192', `8192 (${voyage} maximum)`)
            .setValue(String(plugin.settings.embeddingChunkSize))
            .onChange(async (value) => {
                const suggested = parseInt(value);
                if (suggested !== plugin.settings.embeddingChunkSize) {
                    plugin.settings.embeddingChunkSize = suggested;
                    plugin.requiresIndexWipeOnExit = true;
                    await plugin.saveSettings();
                    // Notify GraphSyncOrchestrator to queue update
                    await plugin.graphSyncOrchestrator.updateConfig(plugin.settings);
                }
            })
        );
}

/**
 * Token estimation ratio — characters per token for budget estimation.
 */
export function configureTokenEstimationRatioField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const tokenRatioDesc = createFragment();
    tokenRatioDesc.appendText('Characters per token for budget estimation. Lower if you use CJK languages or dense code (e.g. 2 for Japanese, 3 for code-heavy vaults). ');
    tokenRatioDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Incorrect values may cause context-window overflow or under-utilisation.' });
    });

    setting.setName('Token estimation ratio')
        .setDesc(tokenRatioDesc)
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.charsPerTokenEstimate))
            .setValue(String(plugin.settings.charsPerTokenEstimate))
            .onChange(async (value) => {
                const num = parseFloat(value);
                if (!isNaN(num) && num > 0 && num <= 10) {
                    plugin.settings.charsPerTokenEstimate = num;
                    await plugin.saveSettings();
                    await plugin.graphSyncOrchestrator.updateConfig(plugin.settings);
                }
            })
        );
}

/**
 * Local worker threads slider — CPU threads for local embeddings.
 */
export function configureLocalWorkerThreadsField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const maxThreads = Math.max(4, navigator.hardwareConcurrency || 4);
    setting.setName(`${local} worker threads`)
        .setDesc(`CPU threads used for ${local.toLowerCase()} embeddings. Higher is faster but heavier.`)
        .addSlider(slider => {
            slider
                .setLimits(1, maxThreads, 1)
                .setValue(plugin.settings.embeddingThreads)
                .onChange(async (value) => {
                    plugin.settings.embeddingThreads = value;
                    await plugin.saveSettings();
                    const service = plugin.embeddingService;
                    if (service && service.updateConfiguration) {
                        void service.updateConfiguration();
                    }
                });
        });
}

// --- Gemini system group ---

/**
 * Gemini API retries — number of retries for spotty connections.
 */
export function configureGeminiApiRetriesField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName(`${gemini} API retries`)
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
            })
        );
}

/**
 * Model cache duration (days) — how long to cache available Gemini models.
 */
export function configureModelCacheDurationField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Model cache duration (days)')
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
            })
        );
}

// --- Voyage system group ---

/**
 * Voyage API retries — number of retries for connections.
 */
export function configureVoyageApiRetriesField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName(`${voyage} API retries`)
        .setDesc('Number of retries for connections.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.voyageRetries))
            .setValue(String(plugin.settings.voyageRetries))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.voyageRetries = num;
                    await plugin.saveSettings();
                }
            })
        );
}

// --- Tuning group ---

/**
 * Primary context threshold slider — score relative to top match for
 * full file content inclusion, with reset button.
 */
export function configurePrimaryContextThresholdField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Primary context threshold')
        .setDesc('Score relative to top match required for full file content inclusion.')
        .addSlider(slider => slider
            .setLimits(0.5, 0.99, 0.05)
            .setValue(plugin.settings.contextPrimaryThreshold)
            .onChange(async (value) => {
                plugin.settings.contextPrimaryThreshold = value;
                await plugin.saveSettings();
            })
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextPrimaryThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

/**
 * Supporting context threshold slider — score for snippet inclusion,
 * with reset button.
 */
export function configureSupportingContextThresholdField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Supporting context threshold')
        .setDesc('Score relative to top match required for snippet inclusion.')
        .addSlider(slider => slider
            .setLimits(0.1, 0.9, 0.05)
            .setValue(plugin.settings.contextSupportingThreshold)
            .onChange(async (value) => {
                plugin.settings.contextSupportingThreshold = value;
                await plugin.saveSettings();
            })
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextSupportingThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

/**
 * Structural context threshold slider — score for header inclusion,
 * with reset button.
 */
export function configureStructuralContextThresholdField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Structural context threshold')
        .setDesc('Score relative to top match required for header inclusion. Below this, notes are skipped.')
        .addSlider(slider => slider
            .setLimits(0.01, 0.5, 0.02)
            .setValue(plugin.settings.contextStructuralThreshold)
            .onChange(async (value) => {
                plugin.settings.contextStructuralThreshold = value;
                await plugin.saveSettings();
            })
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextStructuralThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

/**
 * Search centrality limit slider — max bridge nodes from the graph,
 * with reset button.
 */
export function configureSearchCentralityLimitField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Search centrality limit')
        .setDesc('Max number of "bridge" nodes to pull in from the graph to expand search context. Higher values improve thematic recall but increase token usage.')
        .addSlider(slider => slider
            .setLimits(10, 200, 10)
            .setValue(plugin.settings.searchCentralityLimit)
            .onChange(async (value) => {
                plugin.settings.searchCentralityLimit = value;
                await plugin.saveSettings();
            })
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.searchCentralityLimit})`)
            .onClick(async () => {
                plugin.settings.searchCentralityLimit = DEFAULT_SETTINGS.searchCentralityLimit;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

/**
 * Max context documents slider — safety limit for total documents
 * injected into context, with reset button.
 */
export function configureMaxContextDocumentsField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Max context documents')
        .setDesc('Safety limit for total number of documents injected into context.')
        .addSlider(slider => slider
            .setLimits(5, 500, 5)
            .setValue(plugin.settings.contextMaxFiles)
            .onChange(async (value) => {
                plugin.settings.contextMaxFiles = value;
                await plugin.saveSettings();
            })
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextMaxFiles})`)
            .onClick(async () => {
                plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

/**
 * Reset tuning button — restores all search and context tuning defaults.
 */
export function configureResetTuningField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName('Reset tuning')
        .setDesc('Restore all search and context tuning values to their defaults.')
        .addButton(btn => btn
            .setButtonText('Restore defaults')
            .onClick(async () => {
                plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
                plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
                plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
                plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
                await plugin.saveSettings();
                reRenderSection(context, renderAdvancedSettings);
            })
        );
}

// --- Developer group ---

/**
 * Log level dropdown — console verbosity for debugging.
 */
export function configureLogLevelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Log level')
        .setDesc('Console verbosity for debugging.')
        .addDropdown(dropdown => dropdown
            .addOption(String(LogLevel.DEBUG), 'Debug')
            .addOption(String(LogLevel.INFO), 'Info')
            .addOption(String(LogLevel.WARN), 'Warn')
            .addOption(String(LogLevel.ERROR), 'Error')
            .setValue(String(plugin.settings.logLevel))
            .onChange(async (value) => {
                plugin.settings.logLevel = parseInt(value);
                await plugin.saveSettings();
            })
        );
}

/**
 * Full model list debug button — logs raw API response for models.
 */
export function configureFullModelListDebugField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Full model list debug')
        .setDesc(`Log raw ${api} response for models to console.`)
        .addButton(btn => btn
            .setIcon('terminal')
            .onClick(async () => {
                const apiKey = await plugin.geminiService.getApiKey();
                const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
                const ollamaHeaders = plugin.settings.ollamaHeaders ? await resolveSecrets(plugin.settings.ollamaHeaders, resolveSecret, "ollama-headers-") : {};
                await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, apiKey || '', 0, true, false, false, ollamaHeaders);

                const raw = ModelRegistry.getRawResponse();
                const rawOllama = ModelRegistry.getRawOllamaResponse();
                if (raw) {
                    logger.debug("[VaultIntelligence] Raw Gemini models:", raw);
                }
                if (rawOllama) {
                    logger.debug("[VaultIntelligence] Raw Ollama models:", rawOllama);
                } else if (plugin.settings.ollamaEndpoint) {
                    logger.debug(`[VaultIntelligence] Ollama is offline or unreachable at ${plugin.settings.ollamaEndpoint}`);
                }
            })
        );
}

// --- Security group ---

/**
 * Allow local network access toggle — SSRF risk warning.
 */
export function configureAllowLocalNetworkAccessField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName('Allow local network access (advanced/risky)')
        .setDesc('Allows the agent to access localhost and private network IPs.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.allowLocalNetworkAccess)
            .onChange(async (value) => {
                plugin.settings.allowLocalNetworkAccess = value;
                await plugin.saveSettings();
            })
        );
}

// --- Filter group ---

/**
 * Hidden models toggle list — dynamic list of toggles to hide/show
 * specific models from dropdown menus. Takes a SettingGroup to add
 * settings to.
 */
export function configureHiddenModelsList(
    filterGroup: SettingGroup,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const allModels = ModelRegistry.getAllKnownModels();
    if (allModels.length > 0) {
        allModels.forEach((model) => {
            const isHidden = plugin.settings.hiddenModels.includes(model.id);
            filterGroup.addSetting(setting => {
                setting.setName(model.label)
                    .setDesc(model.id)
                    .addToggle(toggle => toggle
                        .setValue(!isHidden)
                        .setTooltip(isHidden ? "Currently hidden" : "Currently visible")
                        .onChange(async (value) => {
                            if (value) {
                                plugin.settings.hiddenModels = plugin.settings.hiddenModels.filter(id => id !== model.id);
                            } else {
                                if (!plugin.settings.hiddenModels.includes(model.id)) {
                                    plugin.settings.hiddenModels.push(model.id);
                                }
                            }
                            await plugin.saveSettings();
                            plugin.app.workspace.trigger('vault-intelligence:models-updated');
                        })
                    );
            });
        });
    } else {
        filterGroup.addSetting(setting => {
            setting.setName('No models available')
                .setDesc('Configure a provider and fetch models to filter them.')
                .setDisabled(true);
        });
    }
}

export function renderAdvancedSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div: HTMLDivElement) => {
        div.setText('Technical tuning and system-level configurations.');
    });

    // --- 1. Indexing Performance ---
    const performanceHeading = createFragment();
    performanceHeading.appendText('Performance');
    performanceHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: 'Technical tuning for background indexing. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });
    const perfGroup = new SettingGroup(containerEl).setHeading(performanceHeading);

    perfGroup.addSetting(setting => configureIndexingDelayField(setting, plugin, context));
    perfGroup.addSetting(setting => configureIndexingThrottleField(setting, plugin, context));
    perfGroup.addSetting(setting => configureEmbeddingChunkSizeField(setting, plugin, context));
    perfGroup.addSetting(setting => configureTokenEstimationRatioField(setting, plugin, context));

    if (plugin.settings.embeddingProvider === 'local') {
        perfGroup.addSetting(setting => configureLocalWorkerThreadsField(setting, plugin, context));
    }

    // --- 2a. Gemini System and API ---
    const geminiSystemHeading = createFragment();
    geminiSystemHeading.appendText(`${gemini} system and ${api}`);
    geminiSystemHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: `${gemini}-level settings and API connection tuning. ` });
    });
    const geminiSysGroup = new SettingGroup(containerEl).setHeading(geminiSystemHeading);

    geminiSysGroup.addSetting(setting => configureGeminiApiRetriesField(setting, plugin, context));
    geminiSysGroup.addSetting(setting => configureModelCacheDurationField(setting, plugin, context));

    // --- 2b. Voyage System and API ---
    const voyageSystemHeading = createFragment();
    voyageSystemHeading.appendText(`${voyage} system and ${api}`);
    voyageSystemHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: `${voyage}-level settings and API connection tuning. ` });
    });
    const voyageSysGroup = new SettingGroup(containerEl).setHeading(voyageSystemHeading);

    voyageSysGroup.addSetting(setting => configureVoyageApiRetriesField(setting, plugin, context));

    // --- 3. Search and Context Tuning ---
    const tuningHeading = createFragment();
    tuningHeading.appendText('Search and context tuning');
    tuningHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: 'Tune how search expands results and assembles context. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });
    const tuningGroup = new SettingGroup(containerEl).setHeading(tuningHeading);

    tuningGroup.addSetting(setting => configurePrimaryContextThresholdField(setting, plugin, context));
    tuningGroup.addSetting(setting => configureSupportingContextThresholdField(setting, plugin, context));
    tuningGroup.addSetting(setting => configureStructuralContextThresholdField(setting, plugin, context));
    tuningGroup.addSetting(setting => configureSearchCentralityLimitField(setting, plugin, context));
    tuningGroup.addSetting(setting => configureMaxContextDocumentsField(setting, plugin, context));
    tuningGroup.addSetting(setting => configureResetTuningField(setting, plugin, context));

    // --- 4. Developer and Debugging ---
    const devHeading = createFragment();
    devHeading.appendText('Developer');
    devHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: 'Diagnostic tools and logging verbosity. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });
    const devGroup = new SettingGroup(containerEl).setHeading(devHeading);

    devGroup.addSetting(setting => configureLogLevelField(setting, plugin, context));
    devGroup.addSetting(setting => configureFullModelListDebugField(setting, plugin, context));

    // --- 5. Security (Proactive SSRF Protection) ---
    const secHeading = createFragment();
    secHeading.appendText('Security');
    secHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.appendText('Allows the agent to access localhost and private network IPs. ');
        div.createDiv({ cls: 'vault-intelligence-settings-warning' }, (warnDiv) => {
            setIcon(warnDiv.createSpan(), 'lucide-alert-triangle');
            warnDiv.createSpan({ text: ' Warning: This makes you vulnerable to SSRF (Server-Side Request Forgery) and DNS Rebinding attacks. Malicious external websites could resolve to local IP addresses and bypass standard URL checks if the agent reads malicious notes or prompt injections. Use with caution.' });
        });
    });
    const secGroup = new SettingGroup(containerEl).setHeading(secHeading);

    secGroup.addSetting(setting => configureAllowLocalNetworkAccessField(setting, plugin, context));

    // --- 6. Model filtering ---
    const filterHeading = createFragment();
    filterHeading.appendText('Model filtering');
    filterHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: 'Hide specific models from dropdown menus to reduce clutter.' });
    });
    const filterGroup = new SettingGroup(containerEl).setHeading(filterHeading);

    configureHiddenModelsList(filterGroup, plugin, context);
}