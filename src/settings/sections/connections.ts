import { Setting, TextComponent, App, setIcon, Notice } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";
import { ModelRegistry } from "../../services/ModelRegistry";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

interface InternalPlugin {
    manifest: {
        id: string;
    };
}

export function renderConnectionSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Connection').setHeading();

    // --- 1. API Key Setting ---
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
