import { Setting, TextComponent } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { hasGoogleApiKey } from "../../utils/secrets";
import { FolderSuggest } from "../../views/FolderSuggest";
import { renderModelDropdown } from "../components";
import { refreshVisibility } from "../refreshSettings";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS, DEFAULT_GARDENER_SYSTEM_PROMPT } from "../types";

const gardener = "Gardener";
const gemini = "Gemini";
const ontology = "Ontology";
const archive = "Archive";

/**
 * Gardener model dropdown — the model used for analysis and suggestions.
 */
export function configureGardenerModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;
    const gardenerModelCurrent = plugin.settings.gardenerModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);

    setting
        .setName(`${gardener} model`)
        .setDesc('The model used for analysis and suggesting improvements.')
        .addDropdown(dropdown => {
            renderModelDropdown(dropdown, chatModels, gardenerModelCurrent, canUseChat, hasOllama, (val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.gardenerModel = val;
                        await plugin.saveSettings();
                    }
                    refreshVisibility(context);
                })();
            });
        });
}

/**
 * Custom gardener model text input — shown when "custom" is selected.
 */
export function configureCustomGardenerModelField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const gardenerModelCurrent = plugin.settings.gardenerModel;

    setting
        .setName(`Custom ${gardener.toLowerCase()} model`)
        .setDesc(`Enter the specific ${gemini} model ID.`)
        .addText(text => text
            .setPlaceholder(DEFAULT_SETTINGS.gardenerModel)
            .setValue(gardenerModelCurrent)
            .onChange((value) => {
                void (async () => {
                    plugin.settings.gardenerModel = value;
                    await plugin.saveSettings();
                })();
            }));
}

/**
 * Context budget (tokens) — max tokens for a single analysis, with
 * per-model override support.
 */
export function configureGardenerContextBudgetField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const currentModelId = plugin.settings.gardenerModel;
    const gardenerModelLimit = ModelRegistry.getModelById(currentModelId)?.inputTokenLimit ?? 1048576;
    const hasOverride = currentModelId in plugin.settings.modelContextOverrides;
    const resolvedBudget = ModelRegistry.resolveContextBudget(currentModelId, plugin.settings.modelContextOverrides, plugin.settings.gardenerContextBudget);

    const displayValue = Math.min(resolvedBudget, gardenerModelLimit);

    setting
        .setName("Context budget (tokens)")
        .setDesc(hasOverride
            ? `Max tokens allowed for a single analysis. Currently overridden for **${currentModelId}**. (Model limit: ${gardenerModelLimit.toLocaleString()} tokens)`
            : `Max tokens allowed for a single analysis. Currently using provider default. (Model limit: ${gardenerModelLimit.toLocaleString()} tokens)`
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
            text.setPlaceholder('50000')
                .setValue(String(displayValue))
                .onChange((value) => {
                    void (async () => {
                        let num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            if (num > gardenerModelLimit) {
                                num = gardenerModelLimit;
                                text.setValue(String(num));
                            }
                            plugin.settings.modelContextOverrides[currentModelId] = Math.floor(num);
                            await plugin.saveSettings();
                        }
                    })();
                });
            text.inputEl.type = 'number';
        });
}

/**
 * Gardener rules textarea — base persona and hygiene rules.
 */
export function configureGardenerRulesField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName(`${gardener} rules`)
        .setDesc('The base persona and hygiene rules. Use {{ONTOLOGY_FOLDERS}} and {{NOTE_COUNT}} as placeholders.')
        .setClass('vault-intelligence-system-instruction-setting')
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip("Restore original rules (auto-updates with plugin)")
            .setDisabled(plugin.settings.gardenerSystemInstruction === null)
            .setIcon('reset')
            .setTooltip("Restore original rules (auto-updates with plugin)")
            .setDisabled(plugin.settings.gardenerSystemInstruction === null)
            .onClick(() => {
                void (async () => {
                    plugin.settings.gardenerSystemInstruction = null;
                    await plugin.saveSettings();
                    refreshVisibility(context);
                })();
            }))
        .addTextArea(text => {
            text.setPlaceholder(DEFAULT_GARDENER_SYSTEM_PROMPT)
                .setValue(plugin.settings.gardenerSystemInstruction || "")
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.gardenerSystemInstruction = value.trim() === "" ? null : value;
                        await plugin.saveSettings();
                    })();
                });
            text.inputEl.rows = 10;
        });
}

/**
 * Ontology path text input — folder for concepts, entities, and MOCs.
 */
export function configureOntologyPathField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Ontology path')
        .setDesc('Folder where concepts, entities, and MOCs are stored.')
        .addText(text => {
            text.setPlaceholder(ontology)
                .setValue(plugin.settings.ontologyPath)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.ontologyPath = value;
                        await plugin.saveSettings();
                    })();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });
}

/**
 * Gardener plans path text input — folder for proposed plans.
 */
export function configureGardenerPlansPathField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName(`${gardener} plans path`)
        .setDesc(`Folder where proposed ${gardener.toLowerCase()} plans are saved.`)
        .addText(text => {
            text.setPlaceholder(`${gardener}/plans`)
                .setValue(plugin.settings.gardenerPlansPath)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.gardenerPlansPath = value;
                        await plugin.saveSettings();
                    })();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });
}

/**
 * Plans retention (days) — duration to keep plan files before purging.
 */
export function configurePlansRetentionField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Plans retention (days)")
        .setDesc('Duration to keep plan files before purging.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.plansRetentionDays))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        plugin.settings.plansRetentionDays = Math.floor(num);
                        await plugin.saveSettings();
                    }
                })();
            }));
}

/**
 * Archive folder path — where pruned/deleted notes are moved.
 */
export function configureArchiveFolderPathField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Archive folder path')
        .setDesc(`Where to move notes that are pruned or deleted by the ${gardener}.`)
        .addText(text => {
            text.setPlaceholder(`${ontology}/_${archive}`)
                .setValue(plugin.settings.gardenerArchiveFolderPath)
                .onChange(async (value) => {
                    plugin.settings.gardenerArchiveFolderPath = value;
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });
}

/**
 * Orphan grace period (days) — how long a note must be unlinked before
 * the gardener suggests pruning it.
 */
export function configureOrphanGracePeriodField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Orphan grace period (days)")
        .setDesc(`Number of days a note must be unlinked/orphaned before the ${gardener} suggests pruning it.`)
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.gardenerOrphanGracePeriodDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerOrphanGracePeriodDays = Math.floor(num);
                    await plugin.saveSettings();
                }
            }));
}

/**
 * Excluded folders list — a dynamic list builder that renders each
 * excluded folder with a remove button. Takes a container element
 * since it builds multiple Setting rows dynamically.
 */
export function configureExcludedFoldersList(
    containerEl: HTMLElement,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): () => void {
    const renderExcludedFolders = () => {
        containerEl.empty();
        if (plugin.settings.gardenerExcludedFolders.length === 0) {
            containerEl.createEl('i', { text: 'No folders excluded.' });
        }
        plugin.settings.gardenerExcludedFolders.forEach((folder, index) => {
            new Setting(containerEl)
                .setName(folder)
                .addExtraButton(btn => btn
                    .setIcon('trash')
                    .setTooltip('Remove')
                    .setIcon('trash')
                    .setTooltip('Remove')
                    .onClick(() => {
                        void (async () => {
                            plugin.settings.gardenerExcludedFolders.splice(index, 1);
                            await plugin.saveSettings();
                            renderExcludedFolders();
                        })();
                    }));
        });
    };
    renderExcludedFolders();
    return renderExcludedFolders;
}

/**
 * Add excluded folder — text input with FolderSuggest and add button.
 */
export function configureAddExcludedFolderField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext,
    renderExcludedFolders: () => void
): void {
    let addFolderText: TextComponent;
    setting
        .setName('Add excluded folder')
        .setDesc('Search for a folder to ignore.')
        .addText(text => {
            addFolderText = text;
            text.setPlaceholder('Search...');
            new FolderSuggest(plugin.app, text.inputEl);
            text.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    void (async () => {
                        const value = text.getValue().trim();
                        if (value && !plugin.settings.gardenerExcludedFolders.includes(value)) {
                            plugin.settings.gardenerExcludedFolders.push(value);
                            await plugin.saveSettings();
                            text.setValue('');
                            renderExcludedFolders();
                        }
                    })();
                }
            });
        })
        .addExtraButton(btn => btn
            .setIcon('plus-with-circle')
            .onClick(() => {
                void (async () => {
                    const value = addFolderText.getValue().trim();
                    if (value && !plugin.settings.gardenerExcludedFolders.includes(value)) {
                        plugin.settings.gardenerExcludedFolders.push(value);
                        await plugin.saveSettings();
                        addFolderText.setValue('');
                        renderExcludedFolders();
                    }
                })();
            }));
}

/**
 * Recent note limit — max number of recent notes to scan.
 */
export function configureRecentNoteLimitField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Recent note limit")
        .setDesc('Max number of recent notes to scan for improvements.')
        .addText(text => text
            .setPlaceholder('10')
            .setValue(String(plugin.settings.gardenerNoteLimit))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        plugin.settings.gardenerNoteLimit = Math.floor(num);
                        await plugin.saveSettings();
                    }
                })();
            }));
}

/**
 * Re-check cooldown (days) — wait duration before re-examining files.
 */
export function configureRecheckCooldownField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Re-check cooldown (days)")
        .setDesc('Wait duration before re-examining unchanged files.')
        .addText(text => text
            .setPlaceholder('1')
            .setValue(String(plugin.settings.gardenerRecheckDays))
            .onChange((value) => {
                void (async () => {
                    let num = parseFloat(value);
                    if (!isNaN(num) && num >= 0) {
                        // Round to 3 decimal places to avoid float jitter in data.json
                        num = Math.round(num * 1000) / 1000;
                        plugin.settings.gardenerRecheckDays = num;
                        await plugin.saveSettings();
                    }
                })();
            }));
}

/**
 * Skip retention (days) — how long to remember skipped files.
 */
export function configureSkipRetentionField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Skip retention (days)")
        .setDesc('How long to remember skipped files.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.gardenerSkipRetentionDays))
            .onChange((value) => {
                void (async () => {
                    let num = parseFloat(value);
                    if (!isNaN(num) && num >= 0) {
                        // Round to 3 decimal places
                        num = Math.round(num * 1000) / 1000;
                        plugin.settings.gardenerSkipRetentionDays = num;
                        await plugin.saveSettings();
                    }
                })();
            }));
}

/**
 * Semantic merge threshold slider — similarity score required to merge
 * two isolated topics.
 */
export function configureSemanticMergeThresholdField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName("Semantic merge threshold")
        .setDesc('Similarity score required to merge two isolated topics (from 0.5 to 1.0). Set to 1.0 to disable semantic merging.')
        .addSlider(slider => slider
            .setLimits(0.5, 1.0, 0.01)
            .setValue(plugin.settings.gardenerSemanticMergeThreshold)
            .onChange(async (value) => {
                plugin.settings.gardenerSemanticMergeThreshold = value;
                await plugin.saveSettings();
            }));
}

export function renderGardenerSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const hasApiKey = hasGoogleApiKey(plugin.settings);
    const hasOllama = !!plugin.settings.ollamaEndpoint;
    const canUseChat = hasApiKey || hasOllama;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.createSpan({ text: `Configure the ${gardener.toLowerCase()} to maintain your vault’s ontology and hygiene. ` });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.GARDENER, target: '_blank' },
            text: 'View documentation'
        });
    });

    // --- 1. Model & Limits ---
    const gardenerModelCurrent = plugin.settings.gardenerModel;
    const chatModels = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
    const isGardenerPreset = chatModels.some(m => m.id === gardenerModelCurrent);

    configureGardenerModelField(new Setting(containerEl), plugin, context);

    if (canUseChat && !isGardenerPreset) {
        configureCustomGardenerModelField(new Setting(containerEl), plugin, context);
    }

    configureGardenerContextBudgetField(new Setting(containerEl), plugin, context);

    // --- 2. System Instruction ---
    configureGardenerRulesField(new Setting(containerEl), plugin, context);

    // --- 3. Paths & Retention ---
    new Setting(containerEl).setName('Paths and retention').setHeading();

    configureOntologyPathField(new Setting(containerEl), plugin, context);
    configureGardenerPlansPathField(new Setting(containerEl), plugin, context);
    configurePlansRetentionField(new Setting(containerEl), plugin, context);

    new Setting(containerEl).setName('Orphan management').setHeading();

    configureArchiveFolderPathField(new Setting(containerEl), plugin, context);
    configureOrphanGracePeriodField(new Setting(containerEl), plugin, context);

    // --- 4. Exclusions ---
    new Setting(containerEl).setName('Exclusions').setHeading();

    const excludedFoldersEl = containerEl.createDiv();
    const renderExcludedFolders = configureExcludedFoldersList(excludedFoldersEl, plugin, context);

    configureAddExcludedFolderField(new Setting(containerEl), plugin, context, renderExcludedFolders);

    // --- 5. Advanced Tuning ---
    new Setting(containerEl).setName('Analysis tuning').setHeading();

    configureRecentNoteLimitField(new Setting(containerEl), plugin, context);
    configureRecheckCooldownField(new Setting(containerEl), plugin, context);
    configureSkipRetentionField(new Setting(containerEl), plugin, context);
    configureSemanticMergeThresholdField(new Setting(containerEl), plugin, context);
}