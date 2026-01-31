import { Setting, App, Plugin, TextComponent } from "obsidian";

import { UI_CONSTANTS, DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { FolderSuggest } from "../../views/FolderSuggest";
import { SettingsTabContext } from "../SettingsTabContext";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS, DEFAULT_GARDENER_SYSTEM_PROMPT } from "../types";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

export function renderGardenerSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.createSpan({ text: 'Configure the gardener to maintain your vault’s ontology and hygiene. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.GARDENER, target: '_blank' },
            text: 'View documentation'
        });
    });

    const hasApiKey = !!plugin.settings.googleApiKey;


    // --- 1. Model & Limits ---
    const gardenerModelCurrent = plugin.settings.gardenerModel;
    const chatModels = ModelRegistry.getChatModels();
    const isGardenerPreset = chatModels.some(m => m.id === gardenerModelCurrent);

    new Setting(containerEl)
        .setName('Gardener model')
        .setDesc('The model used for analysis and suggesting improvements.')
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
            dropdown.setValue(isGardenerPreset ? gardenerModelCurrent : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        const oldModelId = plugin.settings.gardenerModel;
                        plugin.settings.gardenerContextBudget = ModelRegistry.calculateAdjustedBudget(
                            plugin.settings.gardenerContextBudget,
                            oldModelId,
                            val
                        );
                        plugin.settings.gardenerModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (hasApiKey && !isGardenerPreset) {
        new Setting(containerEl)
            .setName('Custom gardener model')
            .setDesc('Enter the specific Gemini model ID.')
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

    const gardenerModelLimit = ModelRegistry.getModelById(plugin.settings.gardenerModel)?.inputTokenLimit ?? 1048576;
    new Setting(containerEl)
        .setName("Context budget (tokens)")
        .setDesc(`Max tokens allowed for a single analysis. (Model limit: ${gardenerModelLimit.toLocaleString()})`)
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default ratio (${UI_CONSTANTS.DEFAULT_GARDENER_CONTEXT_RATIO * 100}% of model limit)`)
            .setIcon('reset')
            .setTooltip(`Reset to default ratio (${UI_CONSTANTS.DEFAULT_GARDENER_CONTEXT_RATIO * 100}% of model limit)`)
            .onClick(() => {
                void (async () => {
                    const refreshedLimit = ModelRegistry.getModelById(plugin.settings.gardenerModel)?.inputTokenLimit ?? 1048576;
                    plugin.settings.gardenerContextBudget = Math.floor(refreshedLimit * UI_CONSTANTS.DEFAULT_GARDENER_CONTEXT_RATIO);
                    await plugin.saveSettings();
                    refreshSettings(plugin);
                })();
            }))
        .addText(text => {
            text.setPlaceholder('50000')
                .setValue(String(plugin.settings.gardenerContextBudget))
                .onChange((value) => {
                    void (async () => {
                        let num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            if (num > gardenerModelLimit) {
                                num = gardenerModelLimit;
                                text.setValue(String(num));
                            }
                            plugin.settings.gardenerContextBudget = Math.floor(num);
                            await plugin.saveSettings();
                        }
                    })();
                });
            text.inputEl.type = 'number';
        });

    // --- 2. System Instruction ---
    new Setting(containerEl)
        .setName('Gardener rules')
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
                    refreshSettings(plugin);
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

    // --- 3. Paths & Retention ---
    new Setting(containerEl).setName('Paths and retention').setHeading();

    new Setting(containerEl)
        .setName('Ontology path')
        .setDesc('Folder where concepts, entities, and MOCs are stored.')
        .addText(text => {
            text.setPlaceholder('Ontology')
                .setValue(plugin.settings.ontologyPath)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.ontologyPath = value;
                        await plugin.saveSettings();
                    })();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(containerEl)
        .setName('Gardener plans path')
        .setDesc('Folder where proposed gardener plans are saved.')
        .addText(text => {
            text.setPlaceholder('Gardener/plans')
                .setValue(plugin.settings.gardenerPlansPath)
                .onChange((value) => {
                    void (async () => {
                        plugin.settings.gardenerPlansPath = value;
                        await plugin.saveSettings();
                    })();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(containerEl)
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

    // --- 4. Exclusions ---
    new Setting(containerEl).setName('Exclusions').setHeading();

    const excludedFoldersEl = containerEl.createDiv();
    const renderExcludedFolders = () => {
        excludedFoldersEl.empty();
        if (plugin.settings.excludedFolders.length === 0) {
            excludedFoldersEl.createEl('i', { text: 'No folders excluded.' });
        }
        plugin.settings.excludedFolders.forEach((folder, index) => {
            new Setting(excludedFoldersEl)
                .setName(folder)
                .addExtraButton(btn => btn
                    .setIcon('trash')
                    .setTooltip('Remove')
                    .setIcon('trash')
                    .setTooltip('Remove')
                    .onClick(() => {
                        void (async () => {
                            plugin.settings.excludedFolders.splice(index, 1);
                            await plugin.saveSettings();
                            renderExcludedFolders();
                        })();
                    }));
        });
    };
    renderExcludedFolders();

    let addFolderText: TextComponent;
    new Setting(containerEl)
        .setName('Add excluded folder')
        .setDesc('Search for a folder to ignore.')
        .addText(text => {
            addFolderText = text;
            text.setPlaceholder('Search...')
            new FolderSuggest(plugin.app, text.inputEl);
            text.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    void (async () => {
                        const value = text.getValue().trim();
                        if (value && !plugin.settings.excludedFolders.includes(value)) {
                            plugin.settings.excludedFolders.push(value);
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
                    if (value && !plugin.settings.excludedFolders.includes(value)) {
                        plugin.settings.excludedFolders.push(value);
                        await plugin.saveSettings();
                        addFolderText.setValue('');
                        renderExcludedFolders();
                    }
                })();
            }));

    // --- 5. Advanced Tuning ---
    new Setting(containerEl).setName('Analysis tuning').setHeading();

    new Setting(containerEl)
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

    new Setting(containerEl)
        .setName("Re-check cooldown (hours)")
        .setDesc('Wait duration before re-examining unchanged files.')
        .addText(text => text
            .setPlaceholder('24')
            .setValue(String(plugin.settings.gardenerRecheckHours))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        plugin.settings.gardenerRecheckHours = Math.floor(num);
                        await plugin.saveSettings();
                    }
                })();
            }));

    new Setting(containerEl)
        .setName("Skip retention (days)")
        .setDesc('How long to remember skipped files.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.gardenerSkipRetentionDays))
            .onChange((value) => {
                void (async () => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        plugin.settings.gardenerSkipRetentionDays = Math.floor(num);
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
