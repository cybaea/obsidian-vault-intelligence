import { Setting, TextComponent, App, setIcon, Notice } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { SettingsTabContext } from "../SettingsTabContext";
import { BANNER_BASE64 } from "./banner-data";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

interface InternalPlugin {
    manifest: {
        name: string;
        id: string;
    };
}

export function renderConnectionSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;
    const pluginName = (plugin as unknown as InternalPlugin).manifest.name;

    // --- 0. Banner ---
    const bannerLink = containerEl.createEl('a', {
        attr: {
            href: DOCUMENTATION_URLS.BASE,
            rel: 'noopener',
            target: '_blank'
        },
        cls: 'vi-settings-banner-link'
    });

    bannerLink.createEl('img', {
        attr: {
            alt: 'Vault Intelligence Banner',
            src: `data:image/webp;base64,${BANNER_BASE64}`
        },
        cls: 'vi-settings-banner'
    });

    // --- 1. Documentation Setting ---
    new Setting(containerEl)
        .setName('Documentation')
        .setDesc(`Learn how to use ${pluginName} and explore advanced features. `)
        .addButton(btn => btn
            .setButtonText("Open documentation")
            .setIcon('external-link')
            .onClick(() => {
                window.open(DOCUMENTATION_URLS.SECTIONS.CONNECTION, '_blank');
            }));

    // --- 2. API Key Setting ---
    new Setting(containerEl).setName('Connection settings').setHeading();

    const apiKeyDesc = getApiKeyDescription(plugin.app);
    let apiTextInput: TextComponent;

    new Setting(containerEl)
        .setName('Google API key')
        .setDesc(apiKeyDesc)
        .setClass('vault-intelligence-api-setting')
        .addExtraButton(btn => {
            btn.setIcon('eye')
                .setTooltip('Show API key')
                .onClick(() => {
                    if (apiTextInput.inputEl.type === 'password') {
                        apiTextInput.inputEl.type = 'text';
                        btn.setIcon('eye-off');
                        btn.setTooltip('Hide API key');
                    } else {
                        apiTextInput.inputEl.type = 'password';
                        btn.setIcon('eye');
                        btn.setTooltip('Show API key');
                    }
                });
        })
        .addText(text => {
            apiTextInput = text;
            text
                .setPlaceholder('API key')
                .setValue(plugin.settings.googleApiKey)
                .setValue(plugin.settings.googleApiKey)
                .onChange(async (value) => {
                    plugin.settings.googleApiKey = value;
                    await plugin.saveSettings();

                    if (value.startsWith('AIza')) {
                        try {
                            // Fetch models (bypass cache for immediate feedback)
                            await ModelRegistry.fetchModels(plugin.app, value, 0);
                            new Notice("API key valid. Models loaded.");

                            // Refresh current view to enable dropdowns
                            const manifestId = (plugin as unknown as InternalPlugin).manifest.id;
                            (plugin.app as unknown as InternalApp).setting.openTabById(manifestId);
                        } catch {
                            // Don't show notice for every character typed, only if it looks like a full key
                            if (value.length > 30) {
                                new Notice("Failed to load models with this key.");
                            }
                        }
                    }
                });
            text.inputEl.type = 'password';
        });

    // --- 2. Model List Management ---
    new Setting(containerEl).setName('Model management').setHeading();

    new Setting(containerEl)
        .setName('Refresh model list')
        .setDesc('Force a fresh fetch of available models from the Gemini API.')
        .addButton(btn => btn
            .setButtonText("Refresh models")
            .setIcon('refresh-cw')
            .setDisabled(!plugin.settings.googleApiKey)
            .onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText("Refreshing...");
                try {
                    await ModelRegistry.fetchModels(plugin.app, plugin.settings.googleApiKey, 0, true); // bypass cache, throw on error
                    new Notice("Model list refreshed");
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    if (message.includes("400") || message.includes("401") || message.includes("API key")) {
                        new Notice("Invalid API key. Check your settings.");
                    } else {
                        new Notice(`Failed to refresh models: ${message}`);
                    }
                }
                btn.setDisabled(false);
                btn.setButtonText("Refresh models");

                // Refresh the whole UI to update dropdowns
                const manifestId = (plugin as unknown as InternalPlugin).manifest.id;
                (plugin.app as unknown as InternalApp).setting.openTabById(manifestId);
            }));
}

/**
 * Helper for API Key Description
 */
function getApiKeyDescription(app: App): DocumentFragment {
    const configDir = app.vault.configDir;
    const fragment = document.createDocumentFragment();

    fragment.append('Enter your Google Gemini API key.');

    fragment.createDiv({ cls: 'vault-intelligence-settings-info' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-info');
        div.createSpan({}, (textSpan) => {
            textSpan.append('You can obtain an API key from the ');
            textSpan.createEl('a', {
                href: 'https://console.cloud.google.com/apis/credentials',
                text: 'Google Cloud Console'
            });
            textSpan.append('. Make sure to enable the Gemini API for your project.');
        });
    });

    fragment.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-alert-triangle');
        div.createSpan({}, (textSpan) => {
            textSpan.createEl('strong', { text: 'Note: ' });
            textSpan.append(`This key is stored in plain text in this plugin's settings within your ${configDir}/ folder.`);
        });
    });

    return fragment;
}
