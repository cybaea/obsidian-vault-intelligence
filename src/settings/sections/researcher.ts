import { Setting, App, Plugin } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { isComplexLanguage } from "../../utils/language-utils";
import { renderModelDropdown } from "../components";
import { SettingsTabContext } from "../SettingsTabContext";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../types";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderResearcherSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.createSpan({ text: 'Personalise your research assistant’s intelligence and capabilities. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.RESEARCHER, target: '_blank' },
            text: 'View documentation'
        });
    });

    const hasApiKey = !!plugin.settings.googleApiKey;
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;

    // --- 1. Chat Model ---
    const chatModelCurrent = plugin.settings.chatModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
    const isChatPreset = chatModels.some(m => m.id === chatModelCurrent);

    new Setting(containerEl)
        .setName('Chat model')
        .setDesc('The main engine used for reasoning and answering questions.')
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, chatModels, chatModelCurrent, canUseChat, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.chatModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (canUseChat && !isChatPreset) {
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

    // --- 2. Language ---
    const commonLanguages = [
        'English (US)', 'English (GB)', 'German', 'French', 'Japanese',
        'Spanish', 'Chinese (Simplified)', 'Chinese (Traditional)',
        'Russian', 'Portuguese (Brazil)'
    ];
    const currentLang = plugin.settings.agentLanguage || "English (US)";
    const isCustomLang = !commonLanguages.includes(currentLang);

    new Setting(containerEl)
        .setName('Language')
        .setDesc('The language the agent should respond in.')
        .addDropdown(dropdown => {
            commonLanguages.forEach(lang => {
                dropdown.addOption(lang, lang);
            });
            dropdown.addOption('custom', 'Other');

            dropdown.setValue(isCustomLang ? 'custom' : currentLang);

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.agentLanguage = val;

                        // Propagate default changes for chunk size if using standard defaults
                        const isCurrentlyStandard = plugin.settings.embeddingChunkSize === 512 || plugin.settings.embeddingChunkSize === 1024;
                        if (isCurrentlyStandard && plugin.settings.embeddingProvider === 'gemini') {
                            const suggested = isComplexLanguage(val) ? 512 : 1024;
                            if (suggested !== plugin.settings.embeddingChunkSize) {
                                plugin.settings.embeddingChunkSize = suggested;
                                // Notify GraphSyncOrchestrator to queue update
                                await plugin.graphSyncOrchestrator.updateConfig(plugin.settings);
                            }
                        }

                        await plugin.saveSettings();
                        refreshSettings(plugin); // Hide text box if picking preset
                    } else {
                        plugin.settings.agentLanguage = 'custom';
                        await plugin.saveSettings();
                        refreshSettings(plugin); // Show text box
                    }
                })();
            });
        });

    if (isCustomLang) {
        new Setting(containerEl)
            .setName('Custom language code')
            .setDesc('Enter a specific language name or code.')
            .addText(text => text
                .setPlaceholder('en-US')
                .setValue(currentLang === 'custom' ? '' : currentLang)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.agentLanguage = value;
                        await plugin.saveSettings();
                    })();
                }));
    }

    // --- 3. System Instruction ---
    new Setting(containerEl)
        .setName('System instruction')
        .setDesc('Defines the behavior and persona of the agent. Use {{DATE}} to insert the current date and {{LANGUAGE}} for the selected language.')
        .setClass('vault-intelligence-system-instruction-setting')
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip("Restore the default system instruction")
            .setDisabled(plugin.settings.systemInstruction === null)
            .setDisabled(plugin.settings.systemInstruction === null)
            .onClick(() => {
                void (async () => {
                    plugin.settings.systemInstruction = null; // Set to null (reference mode)
                    await plugin.saveSettings();
                    refreshSettings(plugin);
                })();
            }))
        .addTextArea(text => {
            text
                .setPlaceholder(DEFAULT_SYSTEM_PROMPT)
                .setValue(plugin.settings.systemInstruction || "")
                .onChange((value) => {
                    void (async () => {
                        // treating empty string as null/default is cleaner for UX
                        plugin.settings.systemInstruction = value.trim() === "" ? null : value;
                        await plugin.saveSettings();
                    })();
                });
            text.inputEl.rows = 10;
        });

    // --- 4. Context & Reasoning Limits ---
    const currentModelId = plugin.settings.chatModel;
    const chatModelLimit = ModelRegistry.getModelById(currentModelId)?.inputTokenLimit ?? 1048576;
    const hasOverride = currentModelId in plugin.settings.modelContextOverrides;
    const resolvedBudget = ModelRegistry.resolveContextBudget(currentModelId, plugin.settings.modelContextOverrides, plugin.settings.contextWindowTokens);
    
    const displayValue = Math.min(resolvedBudget, chatModelLimit);

    new Setting(containerEl)
        .setName('Context window budget (tokens)')
        .setDesc(hasOverride 
            ? `Max tokens the AI can consider. Currently overridden for **${currentModelId}**. (Model limit: ${chatModelLimit.toLocaleString()} tokens)` 
            : `Max tokens the AI can consider. Currently using provider default. (Model limit: ${chatModelLimit.toLocaleString()} tokens)`
        )
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to provider default`)
            .onClick(() => {
                void (async () => {
                    delete plugin.settings.modelContextOverrides[currentModelId];
                    await plugin.saveSettings();
                    refreshSettings(plugin);
                })();
            }))
        .addText(text => {
            text.setPlaceholder(String(DEFAULT_SETTINGS.contextWindowTokens))
                .setValue(String(displayValue))
                .onChange((value) => {
                    void (async () => {
                        let num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            if (num > chatModelLimit) {
                                num = chatModelLimit;
                                text.setValue(String(num));
                            }
                            plugin.settings.modelContextOverrides[currentModelId] = num;
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
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 1) {
                        plugin.settings.maxAgentSteps = num;
                        await plugin.saveSettings();
                    }
                })();
            }));

    new Setting(containerEl).setName('Context configuration').setHeading();

    new Setting(containerEl)
        .setName('Author name')
        .setDesc('Name used for queries referring to self. Fallback for missing author frontmatter.')
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.authorName)
            .setValue(plugin.settings.authorName)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.authorName = value;
                    await plugin.saveSettings();
                })();
            }));

    new Setting(containerEl)
        .setName('Context aware headers')
        .setDesc('Comma-separated list of frontmatter properties to include in the semantic context of each chunk.')
        .addTextArea(text => text
            .setPlaceholder(DEFAULT_SETTINGS.contextAwareHeaderProperties.join(', '))
            .setValue(plugin.settings.contextAwareHeaderProperties.join(', '))
            .onChange((value) => {
                void (async () => {
                    const props = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    plugin.settings.contextAwareHeaderProperties = props;
                    await plugin.saveSettings();
                })();
            }));

    // --- 4. Specialised Capabilities ---
    new Setting(containerEl).setName('Capabilities').setHeading();

    // Grounding Model
    const groundingModelCurrent = plugin.settings.groundingModel;
    const groundingModels = ModelRegistry.getGroundingModels(plugin.settings.hiddenModels);
    const isGroundingPreset = groundingModels.some(m => m.id === groundingModelCurrent);

    new Setting(containerEl)
        .setName('Enable web search')
        .setDesc('Allows the agent to search the internet for live information, facts, and news.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableWebSearch)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableWebSearch = value;
                    await plugin.saveSettings();
                    refreshSettings(plugin);
                })();
            }));

    if (plugin.settings.enableWebSearch) {
        new Setting(containerEl)
            .setName('Web search model')
            .setDesc(`Model used for verifying facts and searching the web.`)
            .addDropdown(dropdown => {
                renderModelDropdown(dropdown, groundingModels, groundingModelCurrent, hasApiKey, hasOllama, (val) => {
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

    new Setting(containerEl)
        .setName('Enable agent write access')
        .setDesc('Allows the agent to create and update notes in your vault. Always requires manual confirmation.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableAgentWriteAccess)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableAgentWriteAccess = value;
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
                renderModelDropdown(dropdown, chatModels, codeModelCurrent, canUseChat, hasOllama, (val) => {
                    void (async () => {
                        if (val !== 'custom') {
                            plugin.settings.codeModel = val;
                            await plugin.saveSettings();
                        }
                        refreshSettings(plugin);
                    })();
                });
            });

        if (canUseChat && !isCodePreset) {
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
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        plugin.settings.vaultSearchResultsLimit = num;
                        await plugin.saveSettings();
                    }
                })();
            }));
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}
