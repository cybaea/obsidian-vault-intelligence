import { Setting, Notice, Plugin, App, TextComponent } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
import { ModelRegistry } from "../../services/ModelRegistry";
import { FolderSuggest } from "../../views/FolderSuggest";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

/**
 * Renders the Ontology settings section.
 * @param containerEl - The container element to render into.
 * @param plugin - The plugin instance.
 */
export function renderOntologySettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Ontology').setHeading();

    // Fetch models if apiKey is present
    if (plugin.settings.googleApiKey) {
        void (async () => {
            const beforeCount = ModelRegistry.getChatModels().length;
            await ModelRegistry.fetchModels(plugin.app, plugin.settings.googleApiKey, plugin.settings.modelCacheDurationDays);
            const afterCount = ModelRegistry.getChatModels().length;

            if (beforeCount !== afterCount) {
                refreshSettings(plugin);
            }
        })();
    }

    const hasApiKey = !!plugin.settings.googleApiKey;

    new Setting(containerEl)
        .setName('Ontology path')
        .setDesc('Specify the folder where your ontology (concepts, entities, MOCs) is stored.')
        .addText(text => {
            text.setPlaceholder('Ontology')
                .setValue(plugin.settings.ontologyPath)
                .onChange(async (value) => {
                    plugin.settings.ontologyPath = value;
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(containerEl)
        .setName('Gardener plans path')
        .setDesc('Specify the folder where the gardener should save its plans.')
        .addText(text => {
            text.setPlaceholder('Gardener plans')
                .setValue(plugin.settings.gardenerPlansPath)
                .onChange(async (value) => {
                    plugin.settings.gardenerPlansPath = value;
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(containerEl)
        .setName("Plans retention (days)")
        .setDesc('How many days to keep gardener plans before purging them.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.plansRetentionDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.plansRetentionDays = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for retention days.");
                }
            }));

    new Setting(containerEl)
        .setName("Gardener analysis limit")
        .setDesc('Maximum number of recent notes to scan for hygiene improvements.')
        .addText(text => text
            .setPlaceholder('50')
            .setValue(String(plugin.settings.gardenerNoteLimit))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerNoteLimit = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for the analysis limit.");
                }
            }));

    new Setting(containerEl)
        .setName("Gardener context budget (tokens)")
        .setDesc('Maximum total tokens estimated for analysis. The gardener will prioritize recently modified notes until this budget or the analysis limit is reached.')
        .addText(text => text
            .setPlaceholder('50000')
            .setValue(String(plugin.settings.gardenerContextBudget))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num > 0) {
                    plugin.settings.gardenerContextBudget = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for the context budget.");
                }
            }));

    new Setting(containerEl)
        .setName("Skip retention (days)")
        .setDesc('How many days to remember that you skipped/rejected a file before investigating it again.')
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.gardenerSkipRetentionDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerSkipRetentionDays = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for skip retention.");
                }
            }));

    new Setting(containerEl)
        .setName("Re-check cooldown (hours)")
        .setDesc('How long to wait before re-examining a file that has no changes. Set to 0 to always re-examine.')
        .addText(text => text
            .setPlaceholder('24')
            .setValue(String(plugin.settings.gardenerRecheckHours))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.gardenerRecheckHours = Math.floor(num);
                    await plugin.saveSettings();
                } else {
                    new Notice("Please enter a valid positive number for the re-check cooldown.");
                }
            }));

    new Setting(containerEl)
        .setName('Excluded folders')
        .setDesc('Folders the gardener should ignore.')
        .setHeading();

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
                    .setTooltip('Remove folder')
                    .onClick(async () => {
                        plugin.settings.excludedFolders.splice(index, 1);
                        await plugin.saveSettings();
                        renderExcludedFolders();
                    }));
        });
    };

    renderExcludedFolders();

    let addFolderText: TextComponent;
    new Setting(containerEl)
        .setName('Add excluded folder')
        .setDesc('Search for a folder to add to the exclusion list.')
        .addText(text => {
            addFolderText = text;
            text.setPlaceholder('Search folder...')
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
            .setTooltip('Add folder')
            .onClick(async () => {
                const value = addFolderText.getValue().trim();
                if (value && !plugin.settings.excludedFolders.includes(value)) {
                    plugin.settings.excludedFolders.push(value);
                    await plugin.saveSettings();
                    addFolderText.setValue('');
                    renderExcludedFolders();
                }
            }));

    // --- Gardener Model & Persona ---
    new Setting(containerEl).setName('Gardener model and persona').setHeading();

    const gardenerModelCurrent = plugin.settings.gardenerModel;
    const chatModels = ModelRegistry.getChatModels();
    const isGardenerPreset = chatModels.some(m => m.id === gardenerModelCurrent);

    new Setting(containerEl)
        .setName('Gardener model')
        .setDesc('The model used specifically for ontology refinement and hygiene (tidy vault).')
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

            dropdown.setValue(isGardenerPreset ? gardenerModelCurrent : 'custom');

            dropdown.onChange((val) => {
                void (async () => {
                    if (val !== 'custom') {
                        plugin.settings.gardenerModel = val;
                        await plugin.saveSettings();
                    }
                    refreshSettings(plugin);
                })();
            });
        });

    if (!isGardenerPreset) {
        new Setting(containerEl)
            .setName('Custom model ID')
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

    new Setting(containerEl)
        .setName('Gardener system instruction')
        .setDesc('The base persona and rules for the Gardener. Use {{ONTOLOGY_FOLDERS}} and {{NOTE_COUNT}} as placeholders.')
        .setClass('vault-intelligence-system-instruction-setting')
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip("Restore the original gardener rules")
            .onClick(async () => {
                plugin.settings.gardenerSystemInstruction = DEFAULT_SETTINGS.gardenerSystemInstruction;
                await plugin.saveSettings();
                refreshSettings(plugin);
            }))
        .addTextArea(text => {
            text.setPlaceholder('Enter system instructions...')
                .setValue(plugin.settings.gardenerSystemInstruction)
                .onChange(async (value) => {
                    plugin.settings.gardenerSystemInstruction = value;
                    await plugin.saveSettings();
                });
            text.inputEl.rows = 10;
        });
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}
