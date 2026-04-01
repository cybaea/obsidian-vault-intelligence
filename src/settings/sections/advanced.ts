import { SettingGroup, setIcon } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { IEmbeddingClient } from "../../types/providers";
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
    const performanceHeading = document.createDocumentFragment();
    performanceHeading.appendText('Performance');
    performanceHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Technical tuning for background indexing. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });
    const perfGroup = new SettingGroup(containerEl).setHeading(performanceHeading);

    perfGroup.addSetting(setting => {
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
    });

    perfGroup.addSetting(setting => {
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
    });

    const chunkDesc = document.createDocumentFragment();
    chunkDesc.appendText('Target size for vector chunks. Higher values provide more context but risk API rejection if the text is dense (code/cjk).');
    chunkDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    perfGroup.addSetting(setting => {
        setting.setName('Embedding chunk size')
        .setDesc(chunkDesc)
        .addDropdown(dropdown => dropdown
            .addOption('256', `256 (granular / ${local.toLowerCase()} models)`)
            .addOption('512', '512 (standard / cjk max)')
            .addOption('1024', '1024 (high context / code max)')
            .addOption('1500', `1500 (${gemini} safe)`)
            .addOption('2048', `2048 (${gemini} english only)`)
            .addOption('4096', `4096 (large context)`)
            .addOption('8192', `8192 (document scale)`)
            .setValue(String(plugin.settings.embeddingChunkSize))
            .onChange(async (value) => {
                const suggested = parseInt(value);
                if (suggested !== plugin.settings.embeddingChunkSize) {
                    plugin.settings.embeddingChunkSize = suggested;
                    await plugin.saveSettings();
                    // Notify GraphSyncOrchestrator to queue update
                    await plugin.graphSyncOrchestrator.updateConfig(plugin.settings);
                }
            })
        );
    });

    if (plugin.settings.embeddingProvider === 'local') {
        const maxThreads = Math.max(4, navigator.hardwareConcurrency || 4);
        perfGroup.addSetting(setting => {
            setting.setName(`${local} worker threads`)
            .setDesc(`CPU threads used for ${local.toLowerCase()} embeddings. Higher is faster but heavier.`)
            .addSlider(slider => {
                slider
                    .setLimits(1, maxThreads, 1)
                    .setValue(plugin.settings.embeddingThreads)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        plugin.settings.embeddingThreads = value;
                        await plugin.saveSettings();
                        const service = plugin.embeddingService as unknown as IEmbeddingClient;
                        if (service && service.updateConfiguration) {
                            void service.updateConfiguration();
                        }
                    });
            });
        });
    }

    // --- 2. System and API ---
    const systemHeading = document.createDocumentFragment();
    systemHeading.appendText(`System and ${api}`);
    systemHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'System-level settings and API connection tuning. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });
    const sysGroup = new SettingGroup(containerEl).setHeading(systemHeading);

    sysGroup.addSetting(setting => {
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
    });

    sysGroup.addSetting(setting => {
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
    });

    // --- 3. Search and Context Tuning ---
    const tuningHeading = document.createDocumentFragment();
    tuningHeading.appendText('Search and context tuning');
    tuningHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Tune how search expands results and assembles context. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });
    const tuningGroup = new SettingGroup(containerEl).setHeading(tuningHeading);

    const tuningReset = () => {
        plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
        plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
        plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
        plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
    };

    tuningGroup.addSetting(setting => {
        setting.setName('Primary context threshold')
        .setDesc('Score relative to top match required for full file content inclusion.')
        .addSlider(slider => slider
            .setLimits(0.5, 0.99, 0.05)
            .setValue(plugin.settings.contextPrimaryThreshold)
            .setDynamicTooltip()
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
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    tuningGroup.addSetting(setting => {
        setting.setName('Supporting context threshold')
        .setDesc('Score relative to top match required for snippet inclusion.')
        .addSlider(slider => slider
            .setLimits(0.1, 0.9, 0.05)
            .setValue(plugin.settings.contextSupportingThreshold)
            .setDynamicTooltip()
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
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    tuningGroup.addSetting(setting => {
        setting.setName('Structural context threshold')
        .setDesc('Score relative to top match required for header inclusion. Below this, notes are skipped.')
        .addSlider(slider => slider
            .setLimits(0.01, 0.5, 0.02)
            .setValue(plugin.settings.contextStructuralThreshold)
            .setDynamicTooltip()
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
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    tuningGroup.addSetting(setting => {
        setting.setName('Search centrality limit')
        .setDesc('Max number of "bridge" nodes to pull in from the graph to expand search context. Higher values improve thematic recall but increase token usage.')
        .addSlider(slider => slider
            .setLimits(10, 200, 10)
            .setValue(plugin.settings.searchCentralityLimit)
            .setDynamicTooltip()
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
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    tuningGroup.addSetting(setting => {
        setting.setName('Max context documents')
        .setDesc('Safety limit for total number of documents injected into context.')
        .addSlider(slider => slider
            .setLimits(5, 500, 5)
            .setValue(plugin.settings.contextMaxFiles)
            .setDynamicTooltip()
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
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    tuningGroup.addSetting(setting => {
        setting.setName('Reset tuning')
        .setDesc('Restore all search and context tuning values to their defaults.')
        .addButton(btn => btn
            .setButtonText('Restore defaults')
            .onClick(async () => {
                tuningReset();
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            })
        );
    });

    // --- 4. Developer and Debugging ---
    const devHeading = document.createDocumentFragment();
    devHeading.appendText('Developer');
    devHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Diagnostic tools and logging verbosity. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });
    const devGroup = new SettingGroup(containerEl).setHeading(devHeading);

    devGroup.addSetting(setting => {
        setting.setName('Log level')
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
            })
        );
    });

    devGroup.addSetting(setting => {
        setting.setName('Full model list debug')
        .setDesc(`Log raw ${api} response for models to console.`)
        .addButton(btn => btn
            .setIcon('terminal')
            .onClick(async () => {
                const apiKey = await plugin.geminiService.getApiKey();
                await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, apiKey || '', 0, true);
                
                const raw = ModelRegistry.getRawResponse();
                const rawOllama = ModelRegistry.getRawOllamaResponse();
                if (raw) {
                    console.debug("[VaultIntelligence] Raw Gemini models:", raw);
                }
                if (rawOllama) {
                    console.debug("[VaultIntelligence] Raw Ollama models:", rawOllama);
                } else if (plugin.settings.ollamaEndpoint) {
                    console.debug(`[VaultIntelligence] Ollama is offline or unreachable at ${plugin.settings.ollamaEndpoint}`);
                }
            })
        );
    });

    // --- 5. Security (Proactive SSRF Protection) ---
    const secHeading = document.createDocumentFragment();
    secHeading.appendText('Security');
    secHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.appendText('Allows the agent to access localhost and private network IPs. ');
        div.createDiv({ cls: 'vault-intelligence-settings-warning' }, (warnDiv) => {
            setIcon(warnDiv.createSpan(), 'lucide-alert-triangle');
            warnDiv.createSpan({ text: ' Warning: This makes you vulnerable to SSRF (Server-Side Request Forgery) and DNS Rebinding attacks. Malicious external websites could resolve to local IP addresses and bypass standard URL checks if the agent reads malicious notes or prompt injections. Use with caution.' });
        });
    });
    const secGroup = new SettingGroup(containerEl).setHeading(secHeading);

    secGroup.addSetting(setting => {
        setting.setName('Allow local network access (advanced/risky)')
        .setDesc('Allows the agent to access localhost and private network IPs.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.allowLocalNetworkAccess)
            .onChange(async (value) => {
                plugin.settings.allowLocalNetworkAccess = value;
                await plugin.saveSettings();
            })
        );
    });

    // --- 6. Model filtering ---
    const filterHeading = document.createDocumentFragment();
    filterHeading.appendText('Model filtering');
    filterHeading.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Hide specific models from dropdown menus to reduce clutter.' });
    });
    const filterGroup = new SettingGroup(containerEl).setHeading(filterHeading);

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