import { Setting, setIcon } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { LogLevel } from "../../utils/logger";
import { SettingsTabContext } from "../SettingsTabContext";
import { DEFAULT_SETTINGS } from "../types";

export function renderAdvancedSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const gemini = "Gemini";
    const api = "API";
    const local = "Local";

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Technical tuning and system-level configurations.');
    });

    // --- 1. Indexing Performance ---
    new Setting(containerEl)
        .setName('Performance')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Technical tuning for background indexing. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

    new Setting(containerEl)
        .setName('Indexing delay (ms)')
        .setDesc('Debounce delay for background indexing while typing.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.indexingDelayMs))
            .setValue(String(plugin.settings.indexingDelayMs))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num)) {
                    plugin.settings.indexingDelayMs = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Indexing throttle (ms)')
        .setDesc('Delay between files during indexing to respect API rate limits.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.queueDelayMs))
            .setValue(String(plugin.settings.queueDelayMs))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num)) {
                    plugin.settings.queueDelayMs = num;
                    await plugin.saveSettings();
                }
            }));

    const chunkDesc = document.createDocumentFragment();
    chunkDesc.appendText('Target size for vector chunks. Higher values provide more context but risk API rejection if the text is dense (code/cjk).');
    chunkDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Changing this triggers a full vault re-embedding on exit.' });
    });

    new Setting(containerEl)
        .setName('Embedding chunk size')
        .setDesc(chunkDesc)
        .addDropdown(dropdown => dropdown
            .addOption('256', `256 (granular / ${local.toLowerCase()} models)`)
            .addOption('512', '512 (standard / cjk max)')
            .addOption('1024', '1024 (high context / code max)')
            .addOption('1500', `1500 (${gemini} safe)`)
            .addOption('2048', `2048 (${gemini} english only)`)
            .setValue(String(plugin.settings.embeddingChunkSize))
            .onChange(async (value) => {
                const num = parseInt(value);
                plugin.settings.embeddingChunkSize = num;
                await plugin.saveSettings();
                // GraphService will auto-detect change and re-index
                await plugin.graphService.updateConfig(plugin.settings);
            }));

    if (plugin.settings.embeddingProvider === 'local') {
        const maxThreads = Math.max(4, navigator.hardwareConcurrency || 4);
        new Setting(containerEl)
            .setName(`${local} worker threads`)
            .setDesc(`CPU threads used for ${local.toLowerCase()} embeddings. Higher is faster but heavier.`)
            .addSlider(slider => {
                slider
                    .setLimits(1, maxThreads, 1)
                    .setValue(plugin.settings.embeddingThreads)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        plugin.settings.embeddingThreads = value;
                        await plugin.saveSettings();
                        if (plugin.embeddingService.updateConfiguration) {
                            plugin.embeddingService.updateConfiguration();
                        }
                    });
            });
    }

    // --- 2. System and API ---
    new Setting(containerEl)
        .setName(`System and ${api}`)
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'System-level settings and API connection tuning. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

    new Setting(containerEl)
        .setName(`${gemini} API retries`)
        .setDesc('Number of retries for spotty connections.')
        .addText(text => text
            .setPlaceholder(String(DEFAULT_SETTINGS.geminiRetries))
            .setValue(String(plugin.settings.geminiRetries))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.geminiRetries = num;
                    await plugin.saveSettings();
                }
            }));

    new Setting(containerEl)
        .setName('Model cache duration (days)')
        .setDesc(`How long to cache available ${gemini} models locally.`)
        .addText(text => text
            .setPlaceholder('7')
            .setValue(String(plugin.settings.modelCacheDurationDays))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= 0) {
                    plugin.settings.modelCacheDurationDays = num;
                    await plugin.saveSettings();
                }
            }));


    // --- 4. Search and Context Tuning ---
    new Setting(containerEl)
        .setName('Search and context tuning')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Tune how search expands results and assembles context. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.EXPLORER, target: '_blank' },
            text: 'View documentation'
        });
    });


    const tuningReset = () => {
        plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
        plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
        plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
        plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
    };


    new Setting(containerEl)
        .setName('Primary context threshold')
        .setDesc('Score relative to top match required for full file content inclusion.')
        .addSlider(slider => slider
            .setLimits(0.5, 0.99, 0.05)
            .setValue(plugin.settings.contextPrimaryThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextPrimaryThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextPrimaryThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextPrimaryThreshold = DEFAULT_SETTINGS.contextPrimaryThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Supporting context threshold')
        .setDesc('Score relative to top match required for snippet inclusion.')
        .addSlider(slider => slider
            .setLimits(0.1, 0.9, 0.05)
            .setValue(plugin.settings.contextSupportingThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextSupportingThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextSupportingThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextSupportingThreshold = DEFAULT_SETTINGS.contextSupportingThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Structural context threshold')
        .setDesc('Score relative to top match required for header inclusion. Below this, notes are skipped.')
        .addSlider(slider => slider
            .setLimits(0.01, 0.5, 0.02)
            .setValue(plugin.settings.contextStructuralThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextStructuralThreshold = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextStructuralThreshold.toFixed(2)})`)
            .onClick(async () => {
                plugin.settings.contextStructuralThreshold = DEFAULT_SETTINGS.contextStructuralThreshold;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Max context documents')
        .setDesc('Safety limit for total number of documents injected into context.')
        .addSlider(slider => slider
            .setLimits(5, 500, 5)
            .setValue(plugin.settings.contextMaxFiles)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.contextMaxFiles = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(btn => btn
            .setIcon('reset')
            .setTooltip(`Reset to default (${DEFAULT_SETTINGS.contextMaxFiles})`)
            .onClick(async () => {
                plugin.settings.contextMaxFiles = DEFAULT_SETTINGS.contextMaxFiles;
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    new Setting(containerEl)
        .setName('Reset tuning')
        .setDesc('Restore all search and context tuning values to their defaults.')
        .addButton(btn => btn
            .setButtonText('Restore defaults')
            .onClick(async () => {
                tuningReset();
                await plugin.saveSettings();
                context.containerEl.empty();
                renderAdvancedSettings(context);
            }));

    // --- 5. Developer and Debugging ---
    new Setting(containerEl)
        .setName('Developer')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.createSpan({ text: 'Diagnostic tools and logging verbosity. ' });
        div.createEl('a', {
            attr: { href: DOCUMENTATION_URLS.SECTIONS.PERFORMANCE, target: '_blank' },
            text: 'View documentation'
        });
    });

    new Setting(containerEl)
        .setName('Log level')
        .setDesc('Console verbosity for debugging.')
        .addDropdown(dropdown => dropdown
            .addOption(String(LogLevel.DEBUG), 'Debug')
            .addOption(String(LogLevel.INFO), 'Info')
            .addOption(String(LogLevel.WARN), 'Warn')
            .addOption(String(LogLevel.ERROR), 'Error')
            .setValue(String(plugin.settings.logLevel))
            .onChange(async (value) => {
                plugin.settings.logLevel = parseInt(value) as LogLevel;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Full model list debug')
        .setDesc(`Log raw ${api} response for models to console.`)
        .addButton(btn => btn
            .setIcon('terminal')
            .onClick(async () => {
                let raw = ModelRegistry.getRawResponse();
                if (!raw && plugin.settings.googleApiKey) {
                    await ModelRegistry.fetchModels(plugin.app, plugin.settings.googleApiKey, 0);
                    raw = ModelRegistry.getRawResponse();
                }
                if (raw) {
                    console.debug("[VaultIntelligence] Raw models:", raw);
                }
            }));

    // --- 6. Security (Proactive SSRF Protection) ---
    new Setting(containerEl)
        .setName('Security')
        .setHeading();

    const securityDesc = document.createDocumentFragment();
    securityDesc.appendText('Allows the agent to access localhost and private network IPs. ');
    securityDesc.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        setIcon(div.createSpan(), 'lucide-alert-triangle');
        div.createSpan({ text: ' Warning: This makes you vulnerable to SSRF attacks if the agent reads malicious notes or prompt injections. Use with caution.' });
    });

    new Setting(containerEl)
        .setName('Allow local network access (advanced/risky)')
        .setDesc(securityDesc)
        .addToggle(toggle => toggle
            .setValue(plugin.settings.allowLocalNetworkAccess)
            .onChange(async (value) => {
                plugin.settings.allowLocalNetworkAccess = value;
                await plugin.saveSettings();
            }));
}