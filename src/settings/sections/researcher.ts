import { Setting, App, Plugin } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
import { ModelRegistry } from "../../services/ModelRegistry";
import { UI_CONSTANTS } from "../../constants";
import { SettingsTabContext } from "../SettingsTabContext";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderResearcherSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Personalise your research assistant’s intelligence and capabilities.');
    });

    const hasApiKey = !!plugin.settings.googleApiKey;

    // --- 1. Chat Model ---
    const chatModelCurrent = plugin.settings.chatModel;
    const chatModels = ModelRegistry.getChatModels();
    const isChatPreset = chatModels.some(m => m.id === chatModelCurrent);

    new Setting(containerEl)
        .setName('Chat model')
        .setDesc('The main engine used for reasoning and answering questions.')
        .addDropdown(dropdown => {
            if (!hasApiKey) {
                dropdown.addOption('none', 'Enter API key to enable...');
                dropdown.setDisabled(true);
                return;
            }

            for (const m of chatModels) {
                dropdown.addOption(m.id, m.label);
            }

            // Add tooltips to each option
            for (let i = 0; i < dropdown.selectEl.options.length; i++) {
                const opt = dropdown.selectEl.options.item(i);
                if (opt && opt.value !== 'custom') opt.title = opt.value;
            }

            dropdown.addOption('custom', 'Custom model string...');
            dropdown.setValue(isChatPreset ? chatModelCurrent : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        // Scale the budget proportionally to the new model's capacity
                        const oldModelId = plugin.settings.chatModel;
                        plugin.settings.contextWindowTokens = ModelRegistry.calculateAdjustedBudget(
                            plugin.settings.contextWindowTokens,
                            oldModelId,
                            val
                        );

                        plugin.settings.chatModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (hasApiKey && !isChatPreset) {
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

    // --- 2. System Instruction ---
    new Setting(containerEl)
        .setName('System instruction')
        .setDesc('Defines the behavior and persona of the agent. Use {{DATE}} to insert the current date.')
        .setClass('vault-intelligence-system-instruction-setting')
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip("Restore the original system instruction")
            .onClick(async () => {
                plugin.settings.systemInstruction = DEFAULT_SETTINGS.systemInstruction;
                await plugin.saveSettings();
                refreshSettings(plugin);
            }))
        .addTextArea(text => {
            text
                .setPlaceholder(DEFAULT_SETTINGS.systemInstruction)
                .setValue(plugin.settings.systemInstruction)
                .onChange(async (value) => {
                    plugin.settings.systemInstruction = value;
                    await plugin.saveSettings();
                });
            text.inputEl.rows = 10;
        });

    // --- 3. Context & Reasoning Limits ---
    const chatModelLimit = ModelRegistry.getModelById(plugin.settings.chatModel)?.inputTokenLimit ?? 1048576;
    new Setting(containerEl)
        .setName('Context window budget (tokens)')
        .setDesc(`Max tokens the AI can consider. (Model limit: ${chatModelLimit.toLocaleString()} tokens)`)
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default ratio (${UI_CONSTANTS.DEFAULT_CHAT_CONTEXT_RATIO * 100}% of model limit)`)
            .onClick(async () => {
                const refreshedLimit = ModelRegistry.getModelById(plugin.settings.chatModel)?.inputTokenLimit ?? 1048576;
                plugin.settings.contextWindowTokens = Math.floor(refreshedLimit * UI_CONSTANTS.DEFAULT_CHAT_CONTEXT_RATIO);
                await plugin.saveSettings();
                refreshSettings(plugin);
            }))
        .addText(text => {
            text.setPlaceholder(String(DEFAULT_SETTINGS.contextWindowTokens))
                .setValue(String(plugin.settings.contextWindowTokens))
                .onChange((value) => {
                    void (async () => {
                        let num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            if (num > chatModelLimit) {
                                num = chatModelLimit;
                                text.setValue(String(num));
                            }
                            plugin.settings.contextWindowTokens = num;
                            await plugin.saveSettings();
                        }
                    })();
                });
            text.inputEl.type = 'number';
        });

    new Setting(containerEl)
        .setName('Max agent steps')
        .setDesc(`The maximum number of "thoughts" (loops) the agent can take before giving an answer.`)
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.maxAgentSteps))
            .setValue(String(plugin.settings.maxAgentSteps))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 1) {
                    plugin.settings.maxAgentSteps = num;
                    await plugin.saveSettings();
                }
            }));

    // --- 4. Specialised Capabilities ---
    new Setting(containerEl).setName('Capabilities').setHeading();

    // Grounding Model
    const groundingModelCurrent = plugin.settings.groundingModel;
    const groundingModels = ModelRegistry.getGroundingModels();
    const isGroundingPreset = groundingModels.some(m => m.id === groundingModelCurrent);

    new Setting(containerEl)
        .setName('Web search model')
        .setDesc(`Model used for verifying facts and searching the web.`)
        .addDropdown(dropdown => {
            if (!hasApiKey) {
                dropdown.addOption('none', 'Enter API key to enable...');
                dropdown.setDisabled(true);
                return;
            }

            for (const m of groundingModels) {
                dropdown.addOption(m.id, m.label);
            }

            for (let i = 0; i < dropdown.selectEl.options.length; i++) {
                const opt = dropdown.selectEl.options.item(i);
                if (opt && opt.value !== 'custom') opt.title = opt.value;
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

    if (hasApiKey && !isGroundingPreset) {
        new Setting(containerEl)
            .setName('Custom web search model')
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

    // Code Execution
    const python = "Python";
    new Setting(containerEl)
        .setName('Enable computational solver')
        .setDesc(`Allows the agent to write and execute ${python} code for math and data analysis.`)
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
        const isCodePreset = chatModels.some(m => m.id === codeModelCurrent);

        new Setting(containerEl)
            .setName('Code execution model')
            .setDesc(`Specific model used for generating ${python} code.`)
            .addDropdown(dropdown => {
                if (!hasApiKey) {
                    dropdown.addOption('none', 'Enter API key to enable...');
                    dropdown.setDisabled(true);
                    return;
                }

                for (const m of chatModels) {
                    dropdown.addOption(m.id, m.label);
                }

                for (let i = 0; i < dropdown.selectEl.options.length; i++) {
                    const opt = dropdown.selectEl.options.item(i);
                    if (opt && opt.value !== 'custom') opt.title = opt.value;
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

        if (hasApiKey && !isCodePreset) {
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

    // Vault Search Results Limit
    new Setting(containerEl)
        .setName('Vault reading limit')
        .setDesc('Maximum number of notes the researcher can retrieve to answer a single question.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.vaultSearchResultsLimit))
            .setValue(String(plugin.settings.vaultSearchResultsLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.vaultSearchResultsLimit = num;
                    await plugin.saveSettings();
                }
            }));
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}
