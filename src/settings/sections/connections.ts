import { Setting, TextComponent, App, setIcon, Notice, SecretComponent } from "obsidian";

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
    new Setting(containerEl).setName('Connection settings').setHeading()
        .setDesc(getApiKeyDescription(plugin.app, plugin.settings.secretStorageFailure, () => {
            void (async () => {
                plugin.settings.secretStorageFailure = false;
                await plugin.saveSettings();
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- 'Obsidian' is a proper noun but linter flags it
                new Notice("Reload Obsidian to retry migration.");

                // Refresh settings UI
                const manifestId = (plugin as unknown as InternalPlugin).manifest.id;
                (plugin.app as unknown as InternalApp).setting.openTabById(manifestId);
            })();
        }));

    const apiSetting = new Setting(containerEl)
        .setName('Google API key')
        .setClass('vault-intelligence-api-setting');

    if (plugin.settings.secretStorageFailure) {
        // Fallback: Linux with no keyring
        let apiTextInput: TextComponent;
        apiSetting
            .addExtraButton(btn => {
                btn.setIcon('eye')
                    .setTooltip('Show API key')
                    .onClick(() => {
                        if (apiTextInput.inputEl.type === 'password') {
                            apiTextInput.inputEl.type = 'text';
                            btn.setIcon('eye-off');
                        } else {
                            apiTextInput.inputEl.type = 'password';
                            btn.setIcon('eye');
                        }
                    });
            })
            .addText(text => {
                apiTextInput = text;
                text
                    .setPlaceholder('API key')
                    .setValue(plugin.settings.googleApiKey || '')
                    .onChange(async (value) => {
                        plugin.settings.googleApiKey = value;
                        await plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });
    } else {
        // Modern: SecretStorage (v1.11.4+)
        apiSetting.addComponent(el => new SecretComponent(plugin.app, el)
            .setValue(plugin.settings.googleApiKey || '')
            .onChange(async (value) => {
                plugin.settings.googleApiKey = value;
                await plugin.saveSettings();

                // Validation/Feedback hook: resolve the key for validation if it's a secret ID or raw key
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- geminiService is any to avoid circular dependency
                const actualKey: string | null = (value === 'vault-intelligence-api-key')
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- geminiService is any to avoid circular dependency
                    ? plugin.geminiService.getApiKey()
                    : value;

                if (actualKey && actualKey.startsWith('AIza')) {
                    try {
                        await ModelRegistry.fetchModels(plugin.app, actualKey, 0);
                        new Notice("API key valid. Models loaded.");
                    } catch {
                        if (actualKey.length > 30) new Notice("Failed to load models.");
                    }
                }
            }));

        apiSetting.descEl.createEl('div', {
            cls: 'vi-settings-hint',
            text: 'To use a new key, select "create new secret" from the dropdown. Credentials are stored securely and not synced.'
        });
    }

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
function getApiKeyDescription(app: App, storeFailure: boolean, onRetry: () => void): DocumentFragment {
    const configDir = app.vault.configDir;
    const fragment = document.createDocumentFragment();

    fragment.append('Enter your Google Gemini API key.');

    fragment.createDiv({ cls: 'vault-intelligence-settings-info' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-info');
        div.createSpan({}, (textSpan) => {
            textSpan.append('Obtain a key from the ');
            textSpan.createEl('a', {
                href: 'https://console.cloud.google.com/apis/credentials',
                text: 'Google Cloud Console'
            });
            textSpan.append('. Enable Gemini API.');
        });
    });

    if (storeFailure) {
        fragment.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
            const iconSpan = div.createSpan();
            setIcon(iconSpan, 'lucide-alert-triangle');
            div.createSpan({}, (textSpan) => {
                textSpan.createEl('strong', { text: 'Security note: ' });
                textSpan.append(`Secure storage is unavailable on this system. Key is stored in plain text in ${configDir}/ folder.`);
            });
            div.createEl('button', { cls: 'mod-cta', text: 'Retry secure storage' }, (btn) => {
                btn.onclick = () => {
                    void onRetry();
                };
            });
        });
    } else {
        fragment.createDiv({ cls: 'vault-intelligence-settings-success' }, (div) => {
            const iconSpan = div.createSpan();
            setIcon(iconSpan, 'lucide-lock');
            div.createSpan({}, (textSpan) => {
                textSpan.append('Secure storage is active. Credentials are encrypted by the OS keychain.');
            });
        });
    }

    return fragment;
}
