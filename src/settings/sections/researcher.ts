import { Setting } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { isComplexLanguage } from "../../utils/language-utils";
import { hasGoogleApiKey } from "../../utils/secrets";
import { renderModelDropdown } from "../components";
import { refreshVisibility } from "../refreshSettings";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../types";

const google = "Google";
const gemini = "Gemini";
const python = "Python";

/**
 * Fallback language used when {@link VaultIntelligenceSettings.agentLanguage}
 * is empty or unset. Also the first entry in {@link COMMON_LANGUAGES}.
 */
export const DEFAULT_LANGUAGE = 'English (US)';

/**
 * Common languages offered as presets in the language dropdown.
 * Used by {@link configureLanguageField}, {@link renderResearcherSettings},
 * and the {@link VaultIntelligenceSettingTab.isCustomLanguage} visibility
 * predicate in `settingsTab.ts`.
 */
export const COMMON_LANGUAGES: readonly string[] = [
    'English (US)', 'English (GB)', 'German', 'French', 'Japanese',
    'Spanish', 'Chinese (Simplified)', 'Chinese (Traditional)',
    'Russian', 'Portuguese (Brazil)',
] as const;

/**
 * Chat model dropdown — the main reasoning engine selector.
 */
export function configureChatModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;

    const chatModelCurrent = plugin.settings.chatModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);

    setting
        .setName('Chat model')
        .setDesc('The main engine used for reasoning and answering questions.')
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, chatModels, chatModelCurrent, canUseChat, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.chatModel = val;
                        plugin.requiresWorkerRestartOnExit = true;
                        await plugin.saveSettings(true);
                    }
                    refreshVisibility(context);
                })();
            });
        });
}

/**
 * Custom chat model text input — shown only when the chat model
 * dropdown selection is "custom".
 */
export function configureCustomChatModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const chatModelCurrent = plugin.settings.chatModel;

    setting
        .setName('Custom chat model')
        .setDesc(`Enter the specific ${gemini} model ID.`)
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

/**
 * Language dropdown — common presets plus "Other" for custom codes.
 */
export function configureLanguageField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const currentLang = plugin.settings.agentLanguage || DEFAULT_LANGUAGE;
    const isCustomLang = !COMMON_LANGUAGES.includes(currentLang);

    setting
        .setName('Language')
        .setDesc('The language the agent should respond in.')
        .addDropdown(dropdown => {
            COMMON_LANGUAGES.forEach(lang => {
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
                        refreshVisibility(context); // Hide text box if picking preset
                    } else {
                        plugin.settings.agentLanguage = 'custom';
                        await plugin.saveSettings();
                        refreshVisibility(context); // Show text box
                    }
                })();
            });
        });
}

/**
 * Custom language code text input — shown only when "Other" is selected.
 */
export function configureCustomLanguageCodeField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const currentLang = plugin.settings.agentLanguage || DEFAULT_LANGUAGE;

    setting
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

/**
 * System instruction textarea — defines agent behavior and persona.
 */
export function configureSystemInstructionField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('System instruction')
        .setDesc('Defines the behavior and persona of the agent. Use {{DATE}} to insert the current date and {{LANGUAGE}} for the selected language.')
        .setClass('vault-intelligence-system-instruction-setting')
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip("Restore the default system instruction")
            .setDisabled(plugin.settings.systemInstruction === null)
            .onClick(() => {
                void (async () => {
                    plugin.settings.systemInstruction = null; // Set to null (reference mode)
                    await plugin.saveSettings();
                    refreshVisibility(context);
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
}

/**
 * Context window budget — token limit with per-model override support.
 */
export function configureContextWindowBudgetField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const currentModelId = plugin.settings.chatModel;
    const chatModelLimit = ModelRegistry.getModelById(currentModelId)?.inputTokenLimit ?? 1048576;
    const hasOverride = currentModelId in plugin.settings.modelContextOverrides;
    const resolvedBudget = ModelRegistry.resolveContextBudget(currentModelId, plugin.settings.modelContextOverrides, plugin.settings.contextWindowTokens);

    const displayValue = Math.min(resolvedBudget, chatModelLimit);

    setting
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
                    refreshVisibility(context);
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
}

/**
 * Max agent steps — the maximum number of reasoning loops.
 */
export function configureMaxAgentStepsField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
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
}

/**
 * Author name — used for self-referencing queries and frontmatter fallback.
 */
export function configureAuthorNameField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
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
}

/**
 * Context aware headers — comma-separated frontmatter properties.
 */
export function configureContextAwareHeadersField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
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
}

/**
 * Enable web search toggle — allows the agent to search the internet.
 */
export function configureEnableWebSearchField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Enable web search')
        .setDesc('Allows the agent to search the internet for live information, facts, and news.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableWebSearch)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableWebSearch = value;
                    await plugin.saveSettings();
                    refreshVisibility(context);
                })();
            }));
}

/**
 * Enable link context toggle — native URL reading for Gemini 3.1+ models.
 */
export function configureEnableLinkContextField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Enable link context')
        .setDesc(`Allows ${gemini} 3.1+ models to natively read and analyze URLs using ${google}'s highly optimized internal retrieval system.`)
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableUrlContext)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableUrlContext = value;
                    await plugin.saveSettings();
                    refreshVisibility(context);
                })();
            }));
}

/**
 * Web search model dropdown — model used for fact verification.
 */
export function configureWebSearchModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const groundingModelCurrent = plugin.settings.groundingModel;
    const groundingModels = ModelRegistry.getGroundingModels(plugin.settings.hiddenModels);

    setting
        .setName('Web search model')
        .setDesc(`Model used for verifying facts and searching the web.`)
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, groundingModels, groundingModelCurrent, hasApiKey, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.groundingModel = val;
                        await plugin.saveSettings();
                    }
                    refreshVisibility(context);
                })();
            });
        });
}

/**
 * Custom web search model text input — shown when "custom" is selected.
 */
export function configureCustomWebSearchModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const groundingModelCurrent = plugin.settings.groundingModel;

    setting
        .setName('Custom web search model')
        .setDesc(`Enter the specific ${gemini} model ID.`)
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

/**
 * Enable computational solver toggle — Python code execution.
 */
export function configureEnableComputationalSolverField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Enable computational solver')
        .setDesc(`Allows the agent to write and execute ${python} code for math and data analysis.`)
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCodeExecution)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableCodeExecution = value;
                    await plugin.saveSettings();
                    refreshVisibility(context);
                })();
            }));
}

/**
 * Enable agent write access toggle — note creation and updates.
 */
export function configureEnableAgentWriteAccessField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Enable agent write access')
        .setDesc('Allows the agent to create and update notes in your vault. Always requires manual confirmation.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableAgentWriteAccess)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.enableAgentWriteAccess = value;
                    await plugin.saveSettings();
                    refreshVisibility(context);
                })();
            }));
}

/**
 * Code execution model dropdown — model for Python code generation.
 */
export function configureCodeExecutionModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;
    const codeModelCurrent = plugin.settings.codeModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);

    setting
        .setName('Code execution model')
        .setDesc(`Specific model used for generating ${python} code.`)
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, chatModels, codeModelCurrent, canUseChat, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.codeModel = val;
                        await plugin.saveSettings();
                    }
                    refreshVisibility(context);
                })();
            });
        });
}

/**
 * Custom code model text input — shown when "custom" is selected.
 */
export function configureCustomCodeModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const codeModelCurrent = plugin.settings.codeModel;

    setting
        .setName('Custom code model')
        .setDesc(`Enter the specific ${gemini} model ID.`)
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

/**
 * Vault reading limit — max notes retrievable per question.
 */
export function configureVaultReadingLimitField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
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

export function renderResearcherSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.createSpan({ text: 'Personalise your research assistant’s intelligence and capabilities. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.RESEARCHER, target: '_blank' },
            text: 'View documentation'
        });
    });

    // --- 1. Chat Model ---
    const chatModelCurrent = plugin.settings.chatModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
    const isChatPreset = chatModels.some(m => m.id === chatModelCurrent);

    const chatModelSetting = new Setting(containerEl);
    configureChatModelField(chatModelSetting, plugin, context);

    if (canUseChat && !isChatPreset) {
        configureCustomChatModelField(new Setting(containerEl), plugin, context);
    }

    // --- 2. Language ---
    const currentLang = plugin.settings.agentLanguage || DEFAULT_LANGUAGE;
    const isCustomLang = !COMMON_LANGUAGES.includes(currentLang);

    const languageSetting = new Setting(containerEl);
    configureLanguageField(languageSetting, plugin, context);

    if (isCustomLang) {
        configureCustomLanguageCodeField(new Setting(containerEl), plugin, context);
    }

    // --- 3. System Instruction ---
    configureSystemInstructionField(new Setting(containerEl), plugin, context);

    // --- 4. Context & Reasoning Limits ---
    configureContextWindowBudgetField(new Setting(containerEl), plugin, context);
    configureMaxAgentStepsField(new Setting(containerEl), plugin, context);

    new Setting(containerEl).setName('Context configuration').setHeading();

    configureAuthorNameField(new Setting(containerEl), plugin, context);
    configureContextAwareHeadersField(new Setting(containerEl), plugin, context);

    // --- 4. Specialised Capabilities ---
    new Setting(containerEl).setName('Capabilities').setHeading();

    configureEnableWebSearchField(new Setting(containerEl), plugin, context);
    configureEnableLinkContextField(new Setting(containerEl), plugin, context);

    // Grounding Model
    const groundingModelCurrent = plugin.settings.groundingModel;
    const groundingModels = ModelRegistry.getGroundingModels(plugin.settings.hiddenModels);
    const isGroundingPreset = groundingModels.some(m => m.id === groundingModelCurrent);

    if (plugin.settings.enableWebSearch) {
        configureWebSearchModelField(new Setting(containerEl), plugin, context);
        if (hasApiKey && !isGroundingPreset) {
            configureCustomWebSearchModelField(new Setting(containerEl), plugin, context);
        }
    }

    // Code Execution
    configureEnableComputationalSolverField(new Setting(containerEl), plugin, context);
    configureEnableAgentWriteAccessField(new Setting(containerEl), plugin, context);

    if (plugin.settings.enableCodeExecution) {
        const codeModelCurrent = plugin.settings.codeModel;
        const isCodePreset = chatModels.some(m => m.id === codeModelCurrent);

        configureCodeExecutionModelField(new Setting(containerEl), plugin, context);

        if (canUseChat && !isCodePreset) {
            configureCustomCodeModelField(new Setting(containerEl), plugin, context);
        }
    }

    // Vault Search Results Limit
    configureVaultReadingLimitField(new Setting(containerEl), plugin, context);
}