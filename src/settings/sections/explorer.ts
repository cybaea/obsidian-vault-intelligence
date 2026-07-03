import { Notice, Setting, setIcon } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { DOCUMENTATION_URLS } from "../../constants";
import { LocalEmbeddingService } from "../../services/LocalEmbeddingService";
import { ModelRegistry, LOCAL_EMBEDDING_MODELS } from "../../services/ModelRegistry";
import { RoutingEmbeddingService } from "../../services/RoutingEmbeddingService";
import { isComplexLanguage } from "../../utils/language-utils";
import { logger } from "../../utils/logger";
import { hasGoogleApiKey } from "../../utils/secrets";
import { renderModelDropdown } from "../components";
import { reRenderSection } from "../refreshSettings";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS } from "../types";

const gemini = "Gemini";
const ollama = "Ollama";
const voyage = "Voyage AI";
const analyst = "Analyst";
const loop = "Loop";

/**
 * Embedding provider dropdown — selects where document vectors are
 * calculated. Changing this triggers a full vault re-embedding on exit.
 */
export function configureEmbeddingProviderField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const providerDesc = createFragment();
    providerDesc.appendText('Choose where your document vectors are calculated.');
    providerDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    setting
        .setName('Embedding provider')
        .setDesc(providerDesc)
        .addDropdown(dropdown => {
            const google = "Google";
            const geminiLocal = "Gemini";
            const transformers = "Transformers.js";
            dropdown.addOption('gemini', `${google} ${geminiLocal} (cloud)`)
                .addOption('ollama', 'Ollama (local server)')
                .addOption('voyage', `${voyage} (cloud)`)
                .addOption('local', `${transformers} (local)`)
                .setValue(plugin.settings.embeddingProvider)
                .onChange((value) => {
                    void (async () => {
                        const provider = value as 'gemini' | 'local' | 'ollama' | 'voyage';
                        plugin.settings.embeddingProvider = provider;

                        const defaultModelId = ModelRegistry.getDefaultModel('embedding', provider);
                        const modelDef = ModelRegistry.getModelById(defaultModelId);

                        plugin.settings.embeddingModel = defaultModelId;
                        plugin.settings.embeddingDimension = modelDef?.dimensions ?? 768;

                        // Language-aware defaults for chunk size
                        if (provider === 'local') {
                            plugin.settings.embeddingChunkSize = 512;
                            // Set quantization default based on the model's recommended setting
                            plugin.settings.embeddingLocalQuantized = modelDef?.quantized ?? true;
                        } else if (provider === 'voyage') {
                            plugin.settings.embeddingChunkSize = 1024;
                        } else {
                            // Gemini: Check for complex languages (CJK, etc.)
                            plugin.settings.embeddingChunkSize = isComplexLanguage(plugin.settings.agentLanguage) ? 512 : 1024;
                        }

                        plugin.requiresIndexWipeOnExit = true;
                        await plugin.saveSettings(false);
                        reRenderSection(context, renderExplorerSettings);
                    })();
                });
        });
}

/**
 * Embedding model dropdown — shown for gemini, ollama, and voyage providers.
 * Changing this triggers a full vault re-embedding on exit.
 */
export function configureEmbeddingModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const hasVoyage = !!plugin.settings.voyageApiKey || !!plugin.settings.voyageApiKeySecret;
    const providerName = plugin.settings.embeddingProvider;
    const onlineEmbeddingModels = ModelRegistry.getEmbeddingModels(providerName);
    const providerEnabled = providerName === 'gemini' ? hasApiKey : (providerName === 'ollama' ? hasOllama : hasVoyage);

    setting
        .setName('Embedding model')
        .setDesc(`The specific model used to generate vector embeddings.`);

    if (providerEnabled) {
        setting.addDropdown(dropdown => {
            renderModelDropdown(dropdown, onlineEmbeddingModels, plugin.settings.embeddingModel, providerEnabled, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        const modelDef = ModelRegistry.getModelById(val);
                        plugin.settings.embeddingModel = val;
                        if (modelDef?.dimensions) {
                            plugin.settings.embeddingDimension = modelDef.dimensions;
                        } else if (val === 'gemini-embedding-2') {
                            plugin.settings.embeddingDimension = 768;
                        }
                        plugin.requiresIndexWipeOnExit = true;
                        await plugin.saveSettings(false);
                    }
                    reRenderSection(context, renderExplorerSettings);
                })();
            });
        });
    } else {
        const labelName = providerName === 'gemini' ? 'API key' : (providerName === 'ollama' ? 'Ollama endpoint' : 'Voyage API key');
        setting.addText(text => text
            .setPlaceholder(`Configure ${labelName} to enable selection`)
            .setDisabled(true));
    }
}

/**
 * Custom embedding model text input — shown when the selected model
 * is not in the preset list.
 */
export function configureCustomEmbeddingModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const providerName = plugin.settings.embeddingProvider;
    const labelName = providerName === 'gemini' ? "Gemini" : (providerName === 'voyage' ? "Voyage" : "Ollama");
    const current = plugin.settings.embeddingModel;

    setting
        .setName(`Custom ${labelName} model`)
        .setDesc(`Enter the specific ${labelName} embedding model ID.`)
        .addText(text => text
            .setValue(current)
            .onChange(async (val) => {
                plugin.settings.embeddingModel = val;
                plugin.requiresIndexWipeOnExit = true;
                await plugin.saveSettings(false);
            }));
}

/**
 * Embedding dimension dropdown — controls vector size.
 * Changing this triggers a full vault re-embedding on exit.
 */
export function configureEmbeddingDimensionField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const providerName = plugin.settings.embeddingProvider;

    const dimensionDesc = createFragment();
    dimensionDesc.appendText('Control the size of the vector. Higher dimensions mean better search but larger index.');
    dimensionDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    setting
        .setName('Embedding dimension')
        .setDesc(dimensionDesc)
        .addDropdown(dropdown => {
            const currentModel = ModelRegistry.getModelById(plugin.settings.embeddingModel);
            const isModern = plugin.settings.embeddingModel.includes('gemini-embedding');

            if (providerName === 'voyage') {
                dropdown.addOption('1024', '1024 (Standard)')
                    .addOption('512', '512 (Matryoshka)')
                    .addOption('256', '256 (Matryoshka)')
                    .addOption('128', '128 (Matryoshka)')
                    .addOption('2048', '2048 (Large)');
            } else if (providerName === 'ollama') {
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
                dropdown.addOption('768', '768 (Flash / standard)')
                    .addOption('1536', '1536 (Balanced)')
                    .addOption('3072', '3072 (Max / v4 default)');
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

                        plugin.requiresIndexWipeOnExit = true;
                        await plugin.saveSettings(false);
                        reRenderSection(context, renderExplorerSettings);
                    }
                });
        });
}

/**
 * Local embedding model dropdown — for the Transformers.js provider.
 */
export function configureLocalEmbeddingModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Embedding model')
        .setDesc(`The specific model used to generate vector embeddings.`)
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, LOCAL_EMBEDDING_MODELS, plugin.settings.embeddingModel, true, false, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        const modelDef = LOCAL_EMBEDDING_MODELS.find(m => m.id === val);
                        plugin.settings.embeddingModel = val;
                        if (modelDef?.dimensions) {
                            plugin.settings.embeddingDimension = modelDef.dimensions;
                        }
                        // Set quantization default based on the model's recommended setting
                        plugin.settings.embeddingLocalQuantized = modelDef?.quantized ?? true;
                        plugin.requiresIndexWipeOnExit = true;
                        await plugin.saveSettings(false);
                    }
                    reRenderSection(context, renderExplorerSettings);
                })();
            });
        });
}

/**
 * Custom local model ID text input — for custom HuggingFace ONNX models.
 */
export function configureCustomLocalModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const huggingFace = "HuggingFace";
    const onnx = "ONNX";
    const id = "ID";

    setting
        .setName(`Custom model ${id}`)
        .setDesc(`${huggingFace} model id (must be ${onnx} compatible).`)
        .addText(text => text
            .setValue(plugin.settings.embeddingModel)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.embeddingModel = value;
                    plugin.requiresIndexWipeOnExit = true;
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
                            plugin.requiresIndexWipeOnExit = true;
                            await plugin.saveSettings(false);
                            reRenderSection(context, renderExplorerSettings);
                        }
                    } else {
                        new Notice(`Invalid: ${result.reason}`, 5000);
                    }
                    btn.setDisabled(false);
                    btn.setButtonText("Validate");
                })();
            }));
}

/**
 * Local model dimensions text input — for custom local models.
 */
export function configureLocalModelDimensionsField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Model dimensions')
        .setDesc('The output vector size. Incorrect values break search.')
        .addText(text => text
            .setValue(String(plugin.settings.embeddingDimension))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num)) {
                    plugin.settings.embeddingDimension = num;
                    plugin.requiresIndexWipeOnExit = true;
                    await plugin.saveSettings(false);
                }
            }));
}

/**
 * Local model status — force re-download button for local embedding weights.
 */
export function configureLocalModelStatusField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Local model status')
        .setDesc(`Manage the local weights for ${plugin.settings.embeddingModel}.`)
        .addButton(btn => {
            btn
                .setButtonText('Force re-download')
                .setIcon('refresh-cw');
            interface FlexibleButton {
                buttonEl: HTMLButtonElement;
                setDestructive?: () => void;
            }
            const flexBtn = btn as unknown as FlexibleButton;
            if (typeof flexBtn.setDestructive === 'function') {
                flexBtn.setDestructive();
            } else {
                flexBtn.buttonEl.classList.add('mod-destructive');
            }
            btn.onClick(() => {
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
            });
        });
}

/**
 * Quantize local model toggle — enables 8-bit quantization.
 */
export function configureQuantizeLocalModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Quantize local model')
        .setDesc('Enable 8-bit quantization to reduce memory usage and download size. Disable to run unquantized fp32 model fully on the gpu (much faster but uses more memory).')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.embeddingLocalQuantized)
            .onChange(async (value) => {
                plugin.settings.embeddingLocalQuantized = value;
                plugin.requiresIndexWipeOnExit = true;
                await plugin.saveSettings(false);
            }));
}

/**
 * Enable dual-loop search toggle — combines fast local vector search
 * with deep AI re-ranking.
 */
export function configureEnableDualLoopField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Enable dual-loop search')
        .setDesc(`Combine fast local vector search (${loop} 1) with deep AI re-ranking (${loop} 2) for maximum accuracy.`)
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableDualLoop)
            .onChange(async (value) => {
                plugin.settings.enableDualLoop = value;
                await plugin.saveSettings();
                renderExplorerSettings(context); // Refresh to show model selector
            }));
}

/**
 * Re-ranking model dropdown — the AI engine for the second search loop.
 */
export function configureReRankingModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
    const reRankingModelCurrent = plugin.settings.reRankingModel;

    setting
        .setName('Re-ranking model')
        .setDesc(`The AI engine used for the second loop (${analyst}) to verify and rank search results.`)
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, chatModels, reRankingModelCurrent, hasGoogleApiKey(plugin.settings) || !!plugin.settings.ollamaEndpoint, !!plugin.settings.ollamaEndpoint, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.reRankingModel = val;
                        await plugin.saveSettings();
                    }
                    renderExplorerSettings(context);
                })();
            });
        });
}

/**
 * Custom re-ranking model text input — shown when "custom" is selected.
 */
export function configureCustomReRankingModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const reRankingModelCurrent = plugin.settings.reRankingModel;

    setting
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

/**
 * Minimum similarity score slider — relevance threshold.
 */
export function configureMinSimilarityScoreField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Minimum similarity score')
        .setDesc('Relevance threshold. Results below this are hidden.')
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(plugin.settings.minSimilarityScore)
            .onChange(async (value) => {
                plugin.settings.minSimilarityScore = value;
                await plugin.saveSettings();
            }));
}

/**
 * Similar notes limit text input — max results in the sidebar.
 */
export function configureSimilarNotesLimitField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
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
}

/**
 * Semantic graph node limit slider — max nodes in galaxy view.
 */
export function configureSemanticGraphNodeLimitField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Semantic graph node limit')
        .setDesc('Maximum number of nodes to render in the semantic galaxy view.')
        .addSlider(slider => slider
            .setLimits(50, 1000, 50)
            .setValue(plugin.settings.semanticGraphNodeLimit)
            .onChange(async (value) => {
                plugin.settings.semanticGraphNodeLimit = value;
                await plugin.saveSettings();
            }));
}

/**
 * Structural edge thickness slider — visual weight of wikilinks.
 */
export function configureStructuralEdgeThicknessField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Structural edge thickness')
        .setDesc('Visual weight of explicit wikilinks in the semantic galaxy.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.structuralEdgeThickness)
            .onChange(async (value) => {
                plugin.settings.structuralEdgeThickness = value;
                await plugin.saveSettings();
            }));
}

/**
 * Semantic edge thickness slider — visual weight of AI relationships.
 */
export function configureSemanticEdgeThicknessField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Semantic edge thickness')
        .setDesc('Visual weight of implied AI relationships in the semantic galaxy.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.semanticEdgeThickness)
            .onChange(async (value) => {
                plugin.settings.semanticEdgeThickness = value;
                await plugin.saveSettings();
            }));
}

/**
 * Keyword match weight slider — calibration for keyword vs vector search.
 */
export function configureKeywordMatchWeightField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Keyword match weight')
        .setDesc('Calibration for keyword vs vector search. Higher values make keyword matches more conservative.')
        .addSlider(slider => slider
            .setLimits(0.1, 5.0, 0.1)
            .setValue(plugin.settings.keywordWeight)
            .onChange(async (value) => {
                plugin.settings.keywordWeight = value;
                await plugin.saveSettings();
            }));
}

/**
 * Implicit folder semantics dropdown — controls how folder paths map to
 * semantic topics. Changing this triggers a full vault re-scan on exit.
 */
export function configureImplicitFolderSemanticsField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const folderSemDesc = createFragment();
    folderSemDesc.appendText('Controls how physical folder paths are mapped to semantic topics. ');
    folderSemDesc.createEl('a', { attr: { href: DOCUMENTATION_URLS.SECTIONS.FOLDER_SEMANTICS, target: '_blank' }, text: 'Read the guide' });
    const ul = folderSemDesc.createEl('ul', { cls: 'vault-intelligence-settings-list' });
    ul.createEl('li', { text: 'None: folders are ignored.' });
    ul.createEl('li', { text: 'Ontology: match existing ontology notes.' });
    ul.createEl('li', { text: 'All: every folder is a semantic topic.' });

    folderSemDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-scan on exit.' });
    });

    setting
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
}

/**
 * Re-index vault button — wipes and rebuilds all embeddings.
 */
export function configureReIndexVaultField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Re-index vault')
        .setDesc('Wipe and rebuild all embeddings. Required after changing models.')
        .addButton(btn => btn
            .setButtonText('Re-index vault')
            .onClick(() => {
                void (async () => {
                    if (btn.buttonEl.textContent === 'Re-index vault') {
                        btn.setButtonText('Confirm re-scan?');
                        interface FlexibleButton {
                            buttonEl: HTMLButtonElement;
                            setDestructive?: () => void;
                        }
                        const flexBtn = btn as unknown as FlexibleButton;
                        if (typeof flexBtn.setDestructive === 'function') {
                            flexBtn.setDestructive();
                        } else {
                            flexBtn.buttonEl.classList.add('mod-destructive');
                        }
                        window.setTimeout(() => {
                            if (btn.buttonEl.textContent === 'Confirm re-scan?') {
                                btn.setButtonText('Re-index vault');
                                btn.buttonEl.classList.remove('mod-destructive');
                            }
                        }, 5000);
                    } else {
                        try {
                            await plugin.graphSyncOrchestrator.scanAll(true);
                        } catch (e) {
                            const message = e instanceof Error ? e.message : String(e);
                            new Notice(`Re-indexing failed: ${message}`);
                            logger.error("Re-indexing failed", e);
                        } finally {
                            btn.setButtonText('Re-index vault');
                            btn.buttonEl.classList.remove('mod-destructive');
                        }
                    }
                })();
            }));
}

export function renderExplorerSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div: HTMLDivElement) => {
        div.createSpan({ text: 'Configure how the explorer finds connections and similar notes in your vault. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });

    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const hasVoyage = !!plugin.settings.voyageApiKey || !!plugin.settings.voyageApiKeySecret;

    // --- 1. Embedding Provider ---
    configureEmbeddingProviderField(new Setting(containerEl), plugin, context);

    if (plugin.settings.embeddingProvider === 'local') {
        const warning = containerEl.createDiv({ cls: 'vault-intelligence-settings-warning' });
        setIcon(warning.createSpan(), 'lucide-download-cloud');
        warning.createSpan({ text: " Local embeddings download model weights (~25MB - 150MB) once. Analysis is performed 100% offline." });
    }

    // --- 2. Embedding Model ---
    const embeddingSetting = new Setting(containerEl);

    if (plugin.settings.embeddingProvider === 'gemini' || plugin.settings.embeddingProvider === 'ollama' || plugin.settings.embeddingProvider === 'voyage') {
        const providerName = plugin.settings.embeddingProvider;
        const onlineEmbeddingModels = ModelRegistry.getEmbeddingModels(providerName);
        const providerEnabled = providerName === 'gemini' ? hasApiKey : (providerName === 'ollama' ? hasOllama : hasVoyage);

        configureEmbeddingModelField(embeddingSetting, plugin, context);

        const current = plugin.settings.embeddingModel;
        const isPreset = onlineEmbeddingModels.some(m => m.id === current);
        if (providerEnabled && !isPreset) {
            configureCustomEmbeddingModelField(new Setting(containerEl), plugin, context);
        }

        configureEmbeddingDimensionField(new Setting(containerEl), plugin, context);
    } else {
        // Local Provider Models
        configureLocalEmbeddingModelField(embeddingSetting, plugin, context);

        const currentModel = plugin.settings.embeddingModel;
        const isCustom = !LOCAL_EMBEDDING_MODELS.some(m => m.id === currentModel);

        if (isCustom) {
            configureCustomLocalModelField(new Setting(containerEl), plugin, context);
            configureLocalModelDimensionsField(new Setting(containerEl), plugin, context);
        }

        // Force Redownload (Local only)
        configureLocalModelStatusField(new Setting(containerEl), plugin, context);

        // Quantization Option (Local only)
        configureQuantizeLocalModelField(new Setting(containerEl), plugin, context);
    }

    // --- 3. Similarity Thresholds ---
    new Setting(containerEl).setName('Search').setHeading();

    configureEnableDualLoopField(new Setting(containerEl), plugin, context);

    if (plugin.settings.enableDualLoop) {
        const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        const reRankingModelCurrent = plugin.settings.reRankingModel;
        const isReRankingPreset = chatModels.some(m => m.id === reRankingModelCurrent);

        configureReRankingModelField(new Setting(containerEl), plugin, context);

        if (!isReRankingPreset) {
            configureCustomReRankingModelField(new Setting(containerEl), plugin, context);
        }
    }

    configureMinSimilarityScoreField(new Setting(containerEl), plugin, context);
    configureSimilarNotesLimitField(new Setting(containerEl), plugin, context);
    configureSemanticGraphNodeLimitField(new Setting(containerEl), plugin, context);
    configureStructuralEdgeThicknessField(new Setting(containerEl), plugin, context);
    configureSemanticEdgeThicknessField(new Setting(containerEl), plugin, context);
    configureKeywordMatchWeightField(new Setting(containerEl), plugin, context);
    configureImplicitFolderSemanticsField(new Setting(containerEl), plugin, context);

    // --- 4. Re-index Button ---
    configureReIndexVaultField(new Setting(containerEl), plugin, context);
}