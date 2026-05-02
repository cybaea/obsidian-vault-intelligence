import { Setting, Notice, setIcon } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { LocalEmbeddingService } from "../../services/LocalEmbeddingService";
import { ModelRegistry, LOCAL_EMBEDDING_MODELS } from "../../services/ModelRegistry";
import { RoutingEmbeddingService } from "../../services/RoutingEmbeddingService";
import { isComplexLanguage } from "../../utils/language-utils";
import { renderModelDropdown } from "../components";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS } from "../types";



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
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const gemini = "Gemini";
    const ollama = "Ollama";
    const analyst = "Analyst";
    const loop = "Loop";


    const providerDesc = activeDocument.createFragment();
    providerDesc.appendText('Choose where your document vectors are calculated.');
    providerDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    new Setting(containerEl)
        .setName('Embedding provider')
        .setDesc(providerDesc)
        .addDropdown(dropdown => {
            const google = "Google";
            const gemini = "Gemini";
            const transformers = "Transformers.js";
            dropdown.addOption('gemini', `${google} ${gemini} (cloud)`)
                .addOption('ollama', 'Ollama (local server)')
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
                            plugin.settings.embeddingChunkSize = isComplexLanguage(plugin.settings.agentLanguage) ? 512 : 1024;
                        }

                        await plugin.saveSettings(true);
                        containerEl.empty();
                        renderExplorerSettings(context);
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

    if (plugin.settings.embeddingProvider === 'gemini' || plugin.settings.embeddingProvider === 'ollama') {
        const providerName = plugin.settings.embeddingProvider;
        const onlineEmbeddingModels = ModelRegistry.getEmbeddingModels(providerName);
        const providerEnabled = providerName === 'gemini' ? hasApiKey : hasOllama;

        if (providerEnabled) {
            embeddingSetting.addDropdown(dropdown => {
                renderModelDropdown(dropdown, onlineEmbeddingModels, plugin.settings.embeddingModel, providerEnabled, hasOllama, (val) => {
                    void (async () => {
                        if (val !== 'custom') {
                            const modelDef = ModelRegistry.getModelById(val);
                            plugin.settings.embeddingModel = val;
                            if (modelDef?.dimensions) {
                                plugin.settings.embeddingDimension = modelDef.dimensions;
                            }
                            plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
                        }
                        containerEl.empty();
                        renderExplorerSettings(context);
                    })();
                });
            });

            const current = plugin.settings.embeddingModel;
            const isPreset = onlineEmbeddingModels.some(m => m.id === current);
            if (!isPreset) {
                const labelName = providerName === 'gemini' ? "Gemini" : "Ollama";
                new Setting(containerEl)
                    .setName(`Custom ${labelName} model`)
                    .setDesc(`Enter the specific ${labelName} embedding model ID.`)
                    .addText(text => text
                        .setValue(current)
                        .onChange(async (val) => {
                            plugin.settings.embeddingModel = val;
                            plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
                        }));
            }
        } else {
            const labelName = providerName === 'gemini' ? 'API key' : 'Ollama endpoint';
            embeddingSetting.addText(text => text
                .setPlaceholder(`Configure ${labelName} to enable selection`)
                .setDisabled(true));
        }

        const dimensionDesc = activeDocument.createFragment();
        dimensionDesc.appendText('Control the size of the vector. Higher dimensions mean better search but larger index.');
        dimensionDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
            setIcon(div.createSpan(), 'lucide-alert-triangle');
            div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
        });

        new Setting(containerEl)
            .setName('Embedding dimension')
            .setDesc(dimensionDesc)
            .addDropdown(dropdown => {
                const currentModel = ModelRegistry.getModelById(plugin.settings.embeddingModel);
                const isModern = plugin.settings.embeddingModel.includes('gemini-embedding');

                if (providerName === 'ollama') {
                    const nativeDim = currentModel?.dimensions || 768;
                    dropdown.addOption(String(nativeDim), `${nativeDim} (native)`);

                    if (plugin.settings.embeddingModel.includes('nomic')) {
                        // Nomic models support Matryoshka compression
                        const name = 'Matryoshka';
                        if (nativeDim > 512) dropdown.addOption('512', `512 (${name})`);
                        if (nativeDim > 256) dropdown.addOption('256', `256 (${name})`);
                        if (nativeDim > 128) dropdown.addOption('128', `128 (${name})`);
                        dropdown.addOption('64', `64 (${name})`);
                    }
                } else {
                    dropdown.addOption('768', '768 (flash / standard)')
                        .addOption('1536', '1536 (balanced)')
                        .addOption('3072', '3072 (max / v4 default)');
                }

                dropdown.setValue(String(plugin.settings.embeddingDimension))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (num !== plugin.settings.embeddingDimension) {
                            plugin.settings.embeddingDimension = num;

                            // Proactive: If they select high dims but are on an old model, suggest the upgrade
                            if (num > 768 && !isModern && providerName === 'gemini') {
                                new Notice("This dimension works best with modern models like `gemini-embedding-001`. Please check your model selection.");
                            }

                            plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
                            containerEl.empty();
                            renderExplorerSettings(context);
                        }
                    });
            });
    } else {
        // Local Provider Models
        embeddingSetting.addDropdown(dropdown => {
            renderModelDropdown(dropdown, LOCAL_EMBEDDING_MODELS, plugin.settings.embeddingModel, true, false, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        const modelDef = LOCAL_EMBEDDING_MODELS.find(m => m.id === val);
                        plugin.settings.embeddingModel = val;
                        if (modelDef?.dimensions) {
                            plugin.settings.embeddingDimension = modelDef.dimensions;
                        }
                        await plugin.saveSettings(true);
                    }
                    containerEl.empty();
                    renderExplorerSettings(context);
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
                            plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
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
                                    plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
                                    containerEl.empty();
                                    renderExplorerSettings(context);
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
                            plugin.requiresWorkerRestartOnExit = true;
                            await plugin.saveSettings(false);
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
        .setName('Enable dual-loop search')
        .setDesc(`Combine fast local vector search (${loop} 1) with deep AI re-ranking (${loop} 2) for maximum accuracy.`)
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableDualLoop)
            .onChange(async (value) => {
                plugin.settings.enableDualLoop = value;
                await plugin.saveSettings();
                renderExplorerSettings(context); // Refresh to show model selector
            }));

    if (plugin.settings.enableDualLoop) {
        const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        const reRankingModelCurrent = plugin.settings.reRankingModel;
        const isReRankingPreset = chatModels.some(m => m.id === reRankingModelCurrent);

        new Setting(containerEl)
            .setName('Re-ranking model')
            .setDesc(`The AI engine used for the second loop (${analyst}) to verify and rank search results.`)
            .addDropdown(dropdown => {
                renderModelDropdown(dropdown, chatModels, reRankingModelCurrent, !!plugin.settings.googleApiKey || !!plugin.settings.ollamaEndpoint, !!plugin.settings.ollamaEndpoint, (val) => {
                    void (async () => {
                        if (val !== 'custom') {
                            plugin.settings.reRankingModel = val;
                            await plugin.saveSettings();
                        }
                        renderExplorerSettings(context);
                    })();
                });
            });

        if (!isReRankingPreset) {
            new Setting(containerEl)
                .setName('Custom re-ranking model')
                .setDesc(`Enter the specific ${gemini} or ${ollama} model ID.`)
                .addText(text => text
                    .setPlaceholder(DEFAULT_SETTINGS.reRankingModel)
                    .setValue(reRankingModelCurrent)
                    .onChange(async (value) => {
                        plugin.settings.reRankingModel = value;
                        await plugin.saveSettings();
                    }));
        }
    }

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
        .setName('Semantic graph node limit')
        .setDesc('Maximum number of nodes to render in the semantic galaxy view.')
        .addSlider(slider => slider
            .setLimits(50, 1000, 50)
            .setValue(plugin.settings.semanticGraphNodeLimit)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.semanticGraphNodeLimit = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Structural edge thickness')
        .setDesc('Visual weight of explicit wikilinks in the semantic galaxy.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.structuralEdgeThickness)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.structuralEdgeThickness = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Semantic edge thickness')
        .setDesc('Visual weight of implied AI relationships in the semantic galaxy.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.semanticEdgeThickness)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.semanticEdgeThickness = value;
                await plugin.saveSettings();
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

    const folderSemDesc = activeDocument.createFragment();
    folderSemDesc.appendText('Controls how physical folder paths are mapped to semantic topics. ');
    folderSemDesc.createEl('a', { attr: { href: DOCUMENTATION_URLS.SECTIONS.FOLDER_SEMANTICS, target: '_blank' }, text: 'Read the guide' });
    const ul = folderSemDesc.createEl('ul', { cls: 'vault-intelligence-settings-list' });
    ul.createEl('li', { text: 'None: folders are ignored.' });
    ul.createEl('li', { text: 'Ontology: match existing ontology notes.' });
    ul.createEl('li', { text: 'All: every folder is a semantic topic.' });

    folderSemDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-scan on exit.' });
    });

    new Setting(containerEl)
        .setName('Implicit folder semantics')
        .setDesc(folderSemDesc)
        .addDropdown(dropdown => dropdown
            .addOption('none', 'None (ignored)')
            .addOption('ontology', 'Ontology matches only')
            .addOption('all', 'All folders')
            .setValue(plugin.settings.implicitFolderSemantics)
            .onChange(async (value) => {
                if (plugin.settings.implicitFolderSemantics !== value) {
                    plugin.settings.implicitFolderSemantics = value as "none" | "ontology" | "all";
                    plugin.requiresIndexWipeOnExit = true;
                    await plugin.saveSettings();
                }
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
                        activeWindow.setTimeout(() => {
                            if (btn.buttonEl.textContent === 'Confirm re-scan?') {
                                btn.setButtonText('Re-index vault');
                                btn.buttonEl.classList.remove('mod-warning');
                            }
                        }, 5000);
                    } else {
                        try {
                            await plugin.graphSyncOrchestrator.scanAll(true);
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


