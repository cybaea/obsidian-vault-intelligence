import { Setting, Notice, Plugin, App, setIcon } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
// Import the class value (not just type) for instanceof check
import { LocalEmbeddingService } from "../../services/LocalEmbeddingService";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

// Model Defaults
export const MODELS = {
    SMALL: 'MinishLab/potion-base-8M',
    BALANCED: 'Xenova/bge-small-en-v1.5',
    ADVANCED: 'Xenova/nomic-embed-text-v1'
};

export const MODEL_LABELS = {
    SMALL: 'Small (Potion-8M) - 256d [~15MB]',
    BALANCED: 'Balanced (BGE-Small) - 384d [~30MB]',
    ADVANCED: 'Advanced (Nomic-Embed) - 768d [~130MB]',
    CUSTOM: 'Custom (HuggingFace ID)...'
};

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
            .onChange(async (value) => {
                plugin.settings.embeddingProvider = value as 'gemini' | 'local';

                if (value === 'local') {
                    plugin.settings.embeddingModel = 'Xenova/all-MiniLM-L6-v2';
                    plugin.settings.embeddingDimension = 384;
                } else {
                    plugin.settings.embeddingModel = DEFAULT_SETTINGS.embeddingModel;
                    plugin.settings.embeddingDimension = DEFAULT_SETTINGS.embeddingDimension;
                }

                await plugin.saveSettings();
                refreshSettings(plugin);
                new Notice("Provider changed. Please restart the plugin.");
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
            .onChange(async (value) => {
                plugin.settings.embeddingModel = value;
                await plugin.saveSettings();
            }));
    } else {
        embeddingSetting.addDropdown(dropdown => {
            dropdown.addOption(MODELS.SMALL, MODEL_LABELS.SMALL);
            dropdown.addOption(MODELS.BALANCED, MODEL_LABELS.BALANCED);
            dropdown.addOption(MODELS.ADVANCED, MODEL_LABELS.ADVANCED);
            dropdown.addOption('custom', MODEL_LABELS.CUSTOM);

            const current = plugin.settings.embeddingModel;
            const isPreset = Object.values(MODELS).includes(current);
            dropdown.setValue(isPreset ? current : 'custom');

            dropdown.onChange(async (val) => {
                if (val !== 'custom') {
                    plugin.settings.embeddingModel = val;
                    if (val === MODELS.SMALL) plugin.settings.embeddingDimension = 256;
                    if (val === MODELS.BALANCED) plugin.settings.embeddingDimension = 384;
                    if (val === MODELS.ADVANCED) plugin.settings.embeddingDimension = 768;

                    await plugin.saveSettings();
                }
                refreshSettings(plugin);
            });
        });
    }

    // --- 2a. Custom Model Fields (Only if Local + Custom) ---
    const isLocal = plugin.settings.embeddingProvider === 'local';
    const currentModel = plugin.settings.embeddingModel;
    const isCustom = isLocal && !Object.values(MODELS).includes(currentModel);

    if (isCustom) {
        new Setting(containerEl)
            .setName('Custom model ID')
            .setDesc('HuggingFace model ID (e.g. "Xenova/paraphrase-multilingual-MiniLM-L12-v2"). Must be ONNX compatible.')
            .addText(text => text
                .setValue(plugin.settings.embeddingModel)
                .onChange(async (value) => {
                    plugin.settings.embeddingModel = value;
                    await plugin.saveSettings();
                }))
            .addButton(btn => btn
                .setButtonText("Validate")
                .onClick(async () => {
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
                }));

        new Setting(containerEl)
            .setName('Model dimensions')
            .setDesc('The output vector size of this model (e.g. 384, 768). Incorrect values will break search.')
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

    // --- 2b. Download/Refresh Button (Local Only) ---
    if (isLocal) {
        new Setting(containerEl)
            .setName('Model status')
            .setDesc(`Current: ${plugin.settings.embeddingModel}`)
            .addButton(btn => btn
                .setButtonText('Force re-download')
                .setIcon('refresh-cw')
                .setWarning()
                .onClick(async () => {
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
                }));
    }

    new Setting(containerEl)
        .setName('Re-index vault')
        .setDesc('Clear existing embeddings and re-scan the vault. Required if you change models.')
        .addButton(btn => btn
            .setButtonText('Re-index vault')
            .setTooltip('Wipes all vector data and starts fresh')
            .onClick(async () => {
                if (btn.buttonEl.textContent === 'Re-index vault') {
                    btn.setButtonText('Confirm re-index?');
                    btn.setWarning();
                    setTimeout(() => {
                        if (btn.buttonEl.textContent === 'Confirm re-index?') {
                            btn.setButtonText('Re-index vault');
                            btn.buttonEl.classList.remove('mod-warning');
                        }
                    }, 5000);
                } else {
                    await plugin.vectorStore.reindexVault();
                    btn.setButtonText('Re-index vault');
                    btn.buttonEl.classList.remove('mod-warning');
                }
            }));

    // --- 3. Chat Model ---
    new Setting(containerEl)
        .setName('Chat model')
        .setDesc(`The main model used for reasoning and answering questions.`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.chatModel)
            .setValue(plugin.settings.chatModel)
            .onChange(async (value) => {
                plugin.settings.chatModel = value;
                await plugin.saveSettings();
            }));

    // 3.a. Context Window Tokens
    new Setting(containerEl)
        .setName('Context window budget')
        .setDesc('Maximum tokens to use for context.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.contextWindowTokens))
            .setValue(String(plugin.settings.contextWindowTokens))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num > 0) {
                    plugin.settings.contextWindowTokens = num;
                    await plugin.saveSettings();
                }
            }));

    // 4. Grounding Model
    new Setting(containerEl)
        .setName('Grounding model')
        .setDesc(`The fast, cost-effective model used specifically for web searches (e.g., \`${DEFAULT_SETTINGS.groundingModel}\`).`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.groundingModel)
            .setValue(plugin.settings.groundingModel)
            .onChange(async (value) => {
                plugin.settings.groundingModel = value;
                await plugin.saveSettings();
            }));

    // 5. Code Model & Execution Toggle
    new Setting(containerEl)
        .setName('Enable code execution')
        .setDesc('Enable a specialized sub-agent that uses code to solve math problems and complex logic.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCodeExecution)
            .onChange(async (value) => {
                plugin.settings.enableCodeExecution = value;
                await plugin.saveSettings();
                refreshSettings(plugin);
            }));

    if (plugin.settings.enableCodeExecution) {
        new Setting(containerEl)
            .setName('Code model')
            .setDesc(`The model used for code execution (e.g., \`${DEFAULT_SETTINGS.codeModel}\`).`)
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.codeModel)
                .setValue(plugin.settings.codeModel)
                .onChange(async (value) => {
                    plugin.settings.codeModel = value;
                    await plugin.saveSettings();
                }));
    }
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}