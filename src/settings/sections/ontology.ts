import { Setting, Notice, Plugin, App } from "obsidian";
import { IVaultIntelligencePlugin, DEFAULT_SETTINGS } from "../types";
import { GEMINI_CHAT_MODELS } from "../../services/ModelRegistry";

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

    new Setting(containerEl)
        .setName('Ontology path')
        .setDesc('Specify the folder where your ontology (concepts, entities, MOCs) is stored.')
        .addText(text => text
            .setPlaceholder('Ontology')
            .setValue(plugin.settings.ontologyPath)
            .onChange(async (value) => {
                plugin.settings.ontologyPath = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Gardener plans path')
        .setDesc('Specify the folder where the gardener should save its plans.')
        .addText(text => text
            .setPlaceholder('Gardener plans')
            .setValue(plugin.settings.gardenerPlansPath)
            .onChange(async (value) => {
                plugin.settings.gardenerPlansPath = value;
                await plugin.saveSettings();
            }));

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
        .setDesc('Comma-separated list of folders the gardener should ignore.')
        .addTextArea(text => text
            .setPlaceholder('Templates, archive, ontology')
            .setValue(plugin.settings.excludedFolders.join(', '))
            .onChange(async (value) => {
                plugin.settings.excludedFolders = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                await plugin.saveSettings();
            }));

    // --- Gardener Model & Persona ---
    new Setting(containerEl).setName('Gardener model and persona').setHeading();

    const gardenerModelCurrent = plugin.settings.gardenerModel;
    const isGardenerPreset = GEMINI_CHAT_MODELS.some(m => m.id === gardenerModelCurrent);

    new Setting(containerEl)
        .setName('Gardener model')
        .setDesc('The model used specifically for ontology refinement and hygiene (tidy vault).')
        .addDropdown(dropdown => {
            for (const m of GEMINI_CHAT_MODELS) {
                dropdown.addOption(m.id, m.label);
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
        .addTextArea(text => {
            text.setPlaceholder('Enter system instructions...')
                .setValue(plugin.settings.gardenerSystemInstruction)
                .onChange(async (value) => {
                    plugin.settings.gardenerSystemInstruction = value;
                    await plugin.saveSettings();
                });
            text.inputEl.addClass('vault-intelligence-gardener-system-instruction-textarea');
        })
        .addButton(btn => btn
            .setButtonText("Reset to default")
            .setTooltip("Restore the original gardener rules")
            .onClick(async () => {
                plugin.settings.gardenerSystemInstruction = DEFAULT_SETTINGS.gardenerSystemInstruction;
                await plugin.saveSettings();
                refreshSettings(plugin);
            }));
}

function refreshSettings(plugin: IVaultIntelligencePlugin) {
    const app = plugin.app as InternalApp;
    const manifestId = (plugin as unknown as Plugin).manifest.id;
    app.setting.openTabById(manifestId);
}
