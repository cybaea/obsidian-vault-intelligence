import { Setting, Notice, App, Plugin, setIcon } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { LocalEmbeddingService } from "../../services/LocalEmbeddingService";
import { ModelRegistry, LOCAL_EMBEDDING_MODELS } from "../../services/ModelRegistry";
import { RoutingEmbeddingService } from "../../services/RoutingEmbeddingService";
import { SettingsTabContext } from "../SettingsTabContext";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderExplorerSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.createSpan({ text: 'Configure how the explorer finds connections and similar notes in your vault. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });

    const hasApiKey = !!plugin.settings.googleApiKey;


    // --- 1. Embedding Provider ---
    new Setting(containerEl)
        .setName('Embedding provider')
        .setDesc('Choose where your document vectors are calculated.')
        .addDropdown(dropdown => {
            const google = "Google";
            const gemini = "Gemini";
            const transformers = "Transformers.js";
            dropdown.addOption('gemini', `${google} ${gemini} (cloud)`)
                .addOption('local', `${transformers} (local)`)
                .setValue(plugin.settings.embeddingProvider)
                .onChange((value) => {
                    void (async () => {
                        const provider = value as 'gemini' | 'local';
                        plugin.settings.embeddingProvider = provider;

                        const defaultModelId = ModelRegistry.getDefaultModel('embedding', provider);
                        const modelDef = ModelRegistry.getModelById(defaultModelId);

                        plugin.settings.embeddingModel = defaultModelId;
                        plugin.settings.embeddingDimension = modelDef?.dimensions ?? 768;

                        // Language-aware defaults for chunk size
                        if (provider === 'local') {
                            plugin.settings.embeddingChunkSize = 512;
                        } else {
                            // Gemini: Check for complex languages (CJK, etc.)
                            const complexLanguages = ['zh', 'ja', 'ko', 'ar', 'hi', 'th', 'he'];
                            const isComplex = complexLanguages.some(lang =>
                                plugin.settings.agentLanguage.toLowerCase().startsWith(lang)
                            );
                            plugin.settings.embeddingChunkSize = isComplex ? 512 : 1024;
                        }

                        await plugin.saveSettings();
                        refreshSettings(plugin);
                        new Notice("Provider changed. Re-scanning vault suggested.");
                    })();
                });
        });

    if (plugin.settings.embeddingProvider === 'local') {
        const warning = containerEl.createDiv({ cls: 'vault-intelligence-settings-warning' });
        setIcon(warning.createSpan(), 'lucide-download-cloud');
        warning.createSpan({ text: " Local embeddings download model weights (~25MB - 150MB) once. Analysis is performed 100% offline." });
    }

    // --- 2. Embedding Model ---
    const embeddingSetting = new Setting(containerEl)
        .setName('Embedding model')
        .setDesc(`The specific model used to generate vector embeddings.`);

    if (plugin.settings.embeddingProvider === 'gemini') {
        const geminiEmbeddingModels = ModelRegistry.getEmbeddingModels('gemini');
        if (hasApiKey) {
            embeddingSetting.addDropdown(dropdown => {
                for (const m of geminiEmbeddingModels) {
                    dropdown.addOption(m.id, m.label);
                }
                dropdown.addOption('custom', 'Custom model ID...');
                const current = plugin.settings.embeddingModel;
                const isPreset = geminiEmbeddingModels.some(m => m.id === current);
                dropdown.setValue(isPreset ? current : 'custom');

                dropdown.onChange((val) => {
                    void (async () => {
                        if (val !== 'custom') {
                            const modelDef = ModelRegistry.getModelById(val);
                            plugin.settings.embeddingModel = val;
                            if (modelDef?.dimensions) {
                                plugin.settings.embeddingDimension = modelDef.dimensions;
                            }
                            await plugin.saveSettings();
                        }
                        refreshSettings(plugin);
                    })();
                });
            });

            const current = plugin.settings.embeddingModel;
            const isPreset = geminiEmbeddingModels.some(m => m.id === current);
            if (!isPreset) {
                const gemini = "Gemini";
                new Setting(containerEl)
                    .setName(`Custom ${gemini} model`)
                    .setDesc('Enter the specific Gemini embedding model ID.')
                    .addText(text => text
                        .setValue(current)
                        .onChange(async (val) => {
                            plugin.settings.embeddingModel = val;
                            await plugin.saveSettings();
                        }));
            }
        } else {
            embeddingSetting.addText(text => text
                .setPlaceholder('Enter API key to enable Gemini selection')
                .setDisabled(true));
        }

        // Embedding Dimension
        new Setting(containerEl)
            .setName('Embedding dimension')
            .setDesc('Control the size of the vector. Higher dimensions mean better search but larger index. Changing this kills your local index.')
            .addDropdown(dropdown => {
                const currentModel = ModelRegistry.getModelById(plugin.settings.embeddingModel);
                const isModern = currentModel?.id === 'text-embedding-004' || currentModel?.id === 'gemini-embedding-001';

                dropdown.addOption('768', '768 (flash / standard)')
                    .addOption('1536', '1536 (balanced)')
                    .addOption('3072', '3072 (max / v4 default)')
                    .setValue(String(plugin.settings.embeddingDimension))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (num !== plugin.settings.embeddingDimension) {
                            plugin.settings.embeddingDimension = num;

                            // Proactive: If they select high dims but are on an old model, suggest the upgrade
                            if (num > 768 && !isModern) {
                                new Notice("This dimension works best with text-embedding-004. Please check your model selection.");
                            }

                            await plugin.saveSettings();
                            new Notice("Dimension changed. You must re-index your vault for this to take effect.");
                            refreshSettings(plugin);
                        }
                    });
            });
    } else {
        // Local Provider Models
        embeddingSetting.addDropdown(dropdown => {
            for (const m of LOCAL_EMBEDDING_MODELS) {
                dropdown.addOption(m.id, m.label);
            }
            dropdown.addOption('custom', 'Custom (HuggingFace ID)...');

            const current = plugin.settings.embeddingModel;
            const isPreset = LOCAL_EMBEDDING_MODELS.some(m => m.id === current);
            dropdown.setValue(isPreset ? current : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        const modelDef = LOCAL_EMBEDDING_MODELS.find(m => m.id === val);
                        plugin.settings.embeddingModel = val;
                        if (modelDef?.dimensions) {
                            plugin.settings.embeddingDimension = modelDef.dimensions;
                        }
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

        const currentModel = plugin.settings.embeddingModel;
        const isCustom = !LOCAL_EMBEDDING_MODELS.some(m => m.id === currentModel);

        if (isCustom) {
            const huggingFace = "HuggingFace";
            const onnx = "ONNX";
            const id = "ID";
            new Setting(containerEl)
                .setName(`Custom model ${id}`)
                .setDesc(`${huggingFace} model id (must be ${onnx} compatible).`)
                .addText(text => text
                    .setValue(plugin.settings.embeddingModel)
                    .onChange((value) => {
                        void (async () => {
                            plugin.settings.embeddingModel = value;
                            await plugin.saveSettings();
                        })();
                    }))
                .addButton(btn => btn
                    .setButtonText("Validate")
                    .onClick(() => {
                        void (async () => {
                            btn.setDisabled(true);
                            btn.setButtonText("Checking...");
                            const { validateModel } = await import("../../utils/validation");
                            const result = await validateModel(plugin.settings.embeddingModel);
                            if (result.valid) {
                                new Notice(`Valid! Dims: ${result.recommendedDims}`);
                                if (result.recommendedDims) {
                                    plugin.settings.embeddingDimension = result.recommendedDims;
                                    await plugin.saveSettings();
                                    refreshSettings(plugin);
                                }
                            } else {
                                new Notice(`Invalid: ${result.reason}`, 5000);
                            }
                            btn.setDisabled(false);
                            btn.setButtonText("Validate");
                        })();
                    }));

            new Setting(containerEl)
                .setName('Model dimensions')
                .setDesc('The output vector size. Incorrect values break search.')
                .addText(text => text
                    .setValue(String(plugin.settings.embeddingDimension))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            plugin.settings.embeddingDimension = num;
                            await plugin.saveSettings();
                        }
                    }));
        }

        // Force Redownload (Local only)
        new Setting(containerEl)
            .setName('Local model status')
            .setDesc(`Manage the local weights for ${plugin.settings.embeddingModel}.`)
            .addButton(btn => btn
                .setButtonText('Force re-download')
                .setIcon('refresh-cw')
                .setWarning()
                .onClick(() => {
                    void (async () => {
                        const pluginWithService = plugin as unknown as { embeddingService?: unknown };
                        const service = pluginWithService.embeddingService;
                        if (service instanceof RoutingEmbeddingService) {
                            btn.setDisabled(true);
                            btn.setButtonText("Downloading...");
                            await service.forceRedownload();
                            btn.setDisabled(false);
                            btn.setButtonText("Force re-download");
                        } else if (service instanceof LocalEmbeddingService) {
                            btn.setDisabled(true);
                            btn.setButtonText("Downloading...");
                            await service.forceRedownload();
                            btn.setDisabled(false);
                            btn.setButtonText("Force re-download");
                        }
                    })();
                }));
    }

    // --- 3. Similarity Thresholds ---
    new Setting(containerEl).setName('Search').setHeading();

    new Setting(containerEl)
        .setName('Minimum similarity score')
        .setDesc('Relevance threshold. Results below this are hidden.')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.minSimilarityScore)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.minSimilarityScore = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Similar notes limit')
        .setDesc('Max results displayed in the sidebar.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.similarNotesLimit))
            .setValue(String(plugin.settings.similarNotesLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.similarNotesLimit = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Keyword match weight')
        .setDesc('Calibration for keyword vs vector search. Higher values make keyword matches more conservative.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.keywordWeight)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.keywordWeight = value;
                await plugin.saveSettings();
            }));

    // --- 4. Re-index Button ---
    new Setting(containerEl)
        .setName('Re-index vault')
        .setDesc('Wipe and rebuild all embeddings. Required after changing models.')
        .addButton(btn => btn
            .setButtonText('Re-index vault')
            .onClick(() => {
                void (async () => {
                    if (btn.buttonEl.textContent === 'Re-index vault') {
                        btn.setButtonText('Confirm re-scan?');
                        btn.setWarning();
                        setTimeout(() => {
                            if (btn.buttonEl.textContent === 'Confirm re-scan?') {
                                btn.setButtonText('Re-index vault');
                                btn.buttonEl.classList.remove('mod-warning');
                            }
                        }, 5000);
                    } else {
                        try {
                            await plugin.graphService.scanAll(true);
                        } catch (e) {
                            const message = e instanceof Error ? e.message : String(e);
                            new Notice(`Re-indexing failed: ${message}`);
                            console.error(e);
                        } finally {
                            btn.setButtonText('Re-index vault');
                            btn.buttonEl.classList.remove('mod-warning');
                        }
                    }
                })();
            }));
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}
