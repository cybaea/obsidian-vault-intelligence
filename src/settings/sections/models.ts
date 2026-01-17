import { Setting, Notice, Plugin, App, setIcon } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
import { LocalEmbeddingService } from "../../services/LocalEmbeddingService";
import {
    ModelRegistry,
    LOCAL_EMBEDDING_MODELS,
    GEMINI_CHAT_MODELS,
    GEMINI_GROUNDING_MODELS
} from "../../services/ModelRegistry";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderModelSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Models').setHeading();

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Specify the models to use for different tasks.');
    });

    // --- 1. Embedding Provider ---
    new Setting(containerEl)
        .setName('Embedding provider')
        .setDesc('Choose where your document vectors are calculated.')
        .addDropdown(dropdown => dropdown
            .addOption('gemini', 'Google Gemini')
            .addOption('local', 'Transformers.js (local)')
            .setValue(plugin.settings.embeddingProvider)
            .onChange((value) => {
                void (async () => {
                    const provider = value as 'gemini' | 'local';
                    plugin.settings.embeddingProvider = provider;

                    const defaultModelId = ModelRegistry.getDefaultModel('embedding', provider);
                    const modelDef = ModelRegistry.getModelById(defaultModelId);

                    plugin.settings.embeddingModel = defaultModelId;
                    plugin.settings.embeddingDimension = modelDef?.dimensions ?? 768;

                    await plugin.saveSettings();
                    refreshSettings(plugin);
                    new Notice("Provider changed. Please restart the plugin.");
                })();
            }));

    // WARNING BOX for Local Models
    if (plugin.settings.embeddingProvider === 'local') {
        const warning = containerEl.createDiv({ cls: 'vault-intelligence-settings-warning' });
        setIcon(warning.createSpan(), 'lucide-download-cloud');
        warning.createSpan({ text: " Enabling local embeddings requires downloading model weights (~25MB - 150MB) from Hugging Face. This happens once. All analysis is then performed offline on your device." });
    }

    // --- 2. Embedding Model (Dynamic) ---
    const embeddingSetting = new Setting(containerEl)
        .setName('Embedding model')
        .setDesc(`The model used to generate vector embeddings.`);

    if (plugin.settings.embeddingProvider === 'gemini') {
        embeddingSetting.setDesc(`Gemini model ID (Dimensions: ${plugin.settings.embeddingDimension}).`);
        embeddingSetting.addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
            .setValue(plugin.settings.embeddingModel)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.embeddingModel = value;
                    await plugin.saveSettings();
                })();
            }));
    } else {
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
    }

    // --- 2c. Indexing Delay (Relocated for visibility) ---
    const isLocalProvider = plugin.settings.embeddingProvider === 'local';
    new Setting(containerEl)
        .setName('Indexing delay (ms)')
        .setDesc(isLocalProvider
            ? 'Background indexing delay. Helps preserve local compute resources by waiting for you to stop typing.'
            : 'Background indexing delay. Helps protect your API quota and prevents rate limiting by waiting for you to stop typing.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.indexingDelayMs))
            .setValue(String(plugin.settings.indexingDelayMs))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num)) {
                        plugin.settings.indexingDelayMs = num;
                        await plugin.saveSettings();
                    }
                })();
            }));

    new Setting(containerEl)
        .setName('Bulk indexing delay (ms)')
        .setDesc('Delay between files when scanning the entire vault. Helps manage system load and API rate limits during bulk updates.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.queueDelayMs))
            .setValue(String(plugin.settings.queueDelayMs))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num)) {
                        plugin.settings.queueDelayMs = num;
                        await plugin.saveSettings();
                    }
                })();
            }));

    // --- 2a. Custom Model Fields (Only if Local + Custom) ---
    const isLocal = plugin.settings.embeddingProvider === 'local';
    const currentModel = plugin.settings.embeddingModel;
    const isCustom = isLocal && !LOCAL_EMBEDDING_MODELS.some(m => m.id === currentModel);

    if (isCustom) {
        new Setting(containerEl)
            .setName('Custom model ID')
            .setDesc('HuggingFace model ID (e.g. "Xenova/paraphrase-multilingual-MiniLM-L12-v2"). Must be ONNX compatible.')
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
                            new Notice(`Model Valid! ${result.recommendedDims ? `Dims: ${result.recommendedDims}` : ''}`);
                            if (result.recommendedDims) {
                                plugin.settings.embeddingDimension = result.recommendedDims;
                                await plugin.saveSettings();
                                refreshSettings(plugin);
                            }
                        } else {
                            new Notice(`Invalid Model: ${result.reason}`, 5000);
                        }

                        btn.setDisabled(false);
                        btn.setButtonText("Validate");
                    })();
                }));

        new Setting(containerEl)
            .setName('Model dimensions')
            .setDesc('The output vector size of this model (e.g. 384, 768). Incorrect values will break search.')
            .addText(text => text
                .setValue(String(plugin.settings.embeddingDimension))
                .onChange((value) => {
                    void (async () => {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            plugin.settings.embeddingDimension = num;
                            await plugin.saveSettings();
                        }
                    })();
                }));
    }

    // --- 2b. Download/Refresh Button (Local Only) ---
    if (isLocal) {
        new Setting(containerEl)
            .setName('Model status')
            .setDesc(`Current: ${plugin.settings.embeddingModel}`)
            .addButton(btn => btn
                .setButtonText('Force re-download')
                .setIcon('refresh-cw')
                .setWarning()
                .onClick(() => {
                    void (async () => {
                        const pluginWithService = plugin as unknown as { embeddingService?: unknown };
                        const service = pluginWithService.embeddingService;

                        if (service instanceof LocalEmbeddingService) {
                            btn.setDisabled(true);
                            btn.setButtonText("Downloading...");

                            await service.forceRedownload();

                            btn.setDisabled(false);
                            btn.setButtonText("Force re-download");
                        } else {
                            new Notice("Local embedding service is not active");
                        }
                    })();
                }));
    }

    new Setting(containerEl)
        .setName('Re-index vault')
        .setDesc('Clear existing embeddings and re-scan the vault. Required if you change models.')
        .addButton(btn => btn
            .setButtonText('Re-index vault')
            .setTooltip('Wipes all vector data and starts fresh')
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
                        await plugin.graphService.scanAll(true);
                        btn.setButtonText('Re-index vault');
                        btn.buttonEl.classList.remove('mod-warning');
                    }
                })();
            }));

    // --- 3. Chat Model ---
    const chatModelCurrent = plugin.settings.chatModel;
    const isChatPreset = GEMINI_CHAT_MODELS.some(m => m.id === chatModelCurrent);

    new Setting(containerEl)
        .setName('Chat model')
        .setDesc('Main model used for reasoning and answering questions.')
        .addDropdown(dropdown => {
            for (const m of GEMINI_CHAT_MODELS) {
                dropdown.addOption(m.id, m.label);
            }
            dropdown.addOption('custom', 'Custom model string...');

            dropdown.setValue(isChatPreset ? chatModelCurrent : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.chatModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (!isChatPreset) {
        new Setting(containerEl)
            .setName('Custom chat model')
            .setDesc('Enter the specific Gemini model ID.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.chatModel)
                .setValue(chatModelCurrent)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.chatModel = value;
                        await plugin.saveSettings();
                    })();
                }));
    }

    new Setting(containerEl)
        .setName('Context window budget')
        .setDesc("Max tokens the AI can consider. This is also limited by your chosen chat model's capacity.")
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.contextWindowTokens))
            .setValue(String(plugin.settings.contextWindowTokens))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        plugin.settings.contextWindowTokens = num;
                        await plugin.saveSettings();
                    }
                })();
            }));

    // 4. Grounding Model
    const groundingModelCurrent = plugin.settings.groundingModel;
    const isGroundingPreset = GEMINI_GROUNDING_MODELS.some(m => m.id === groundingModelCurrent);

    new Setting(containerEl)
        .setName('Grounding model')
        .setDesc(`The fast, cost-effective model used specifically for web searches.`)
        .addDropdown(dropdown => {
            for (const m of GEMINI_GROUNDING_MODELS) {
                dropdown.addOption(m.id, m.label);
            }
            dropdown.addOption('custom', 'Custom model string...');

            dropdown.setValue(isGroundingPreset ? groundingModelCurrent : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.groundingModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (!isGroundingPreset) {
        new Setting(containerEl)
            .setName('Custom grounding model')
            .setDesc('Enter the specific Gemini model ID.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.groundingModel)
                .setValue(groundingModelCurrent)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.groundingModel = value;
                        await plugin.saveSettings();
                    })();
                }));
    }

    // 5. Code Model & Execution Toggle
    new Setting(containerEl)
        .setName('Enable code execution')
        .setDesc('Enable a specialized sub-agent that uses code to solve math problems and complex logic.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCodeExecution)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableCodeExecution = value;
                    await plugin.saveSettings();
                    refreshSettings(plugin);
                })();
            }));

    if (plugin.settings.enableCodeExecution) {
        const codeModelCurrent = plugin.settings.codeModel;
        const isCodePreset = GEMINI_CHAT_MODELS.some(m => m.id === codeModelCurrent);

        new Setting(containerEl)
            .setName('Code model')
            .setDesc(`The model used for code execution.`)
            .addDropdown(dropdown => {
                for (const m of GEMINI_CHAT_MODELS) {
                    dropdown.addOption(m.id, m.label);
                }
                dropdown.addOption('custom', 'Custom model string...');

                dropdown.setValue(isCodePreset ? codeModelCurrent : 'custom');

                dropdown.onChange((val) => {
                    void (async () => {
                        if (val !== 'custom') {
                            plugin.settings.codeModel = val;
                            await plugin.saveSettings();
                        }
                        refreshSettings(plugin);
                    })();
                });
            });

        if (!isCodePreset) {
            new Setting(containerEl)
                .setName('Custom code model')
                .setDesc('Enter the specific Gemini model ID.')
                .addText(text => text
                    .setPlaceholder(DEFAULT_SETTINGS.codeModel)
                    .setValue(codeModelCurrent)
                    .onChange((value) => {
                        void (async () => {
                            plugin.settings.codeModel = value;
                            await plugin.saveSettings();
                        })();
                    }));
        }
    }
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}