import { Setting, App, setIcon, Notice, SecretComponent, requestUrl } from "obsidian";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { validateHeaderKey } from "../../utils/headers";
import { resolveSecrets } from "../../utils/secrets";
import { renderKeyValueEditor } from "../components";
import { SettingsTabContext } from "../SettingsTabContext";
import "../components"; // Ensure prototype extensions load
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

                const obsidian = "Obsidian";
                new Notice(`Reload ${obsidian} to retry migration.`);

                // Refresh settings UI
                const manifestId = (plugin as unknown as InternalPlugin).manifest.id;
                (plugin.app as unknown as InternalApp).setting.openTabById(manifestId);
            })();
        }));

    const google = "Google";
    const gemini = "Gemini";
    const ollama = "Ollama";

    const apiSetting = new Setting(containerEl)
        .setName(`${google} API key`)
        .setClass('vault-intelligence-api-setting');

    if (plugin.settings.secretStorageFailure) {
        // Fallback: Linux with no keyring
        apiSetting
            .addText(text => {
                text
                    .setPlaceholder('API key')
                    .setValue(plugin.settings.googleApiKey || '')
                    .setPassword()
                    .onChange(async (value) => {
                        plugin.settings.googleApiKey = value;
                        await plugin.saveSettings();
                    });
            });
    } else {
        // Modern: SecretStorage (v1.11.4+)
        apiSetting.addComponent(el => new SecretComponent(plugin.app, el)
            .setValue(plugin.settings.googleApiKey || '')
            .onChange(async (value) => {
                plugin.settings.googleApiKey = value;
                await plugin.saveSettings();

                const actualKey: string | null = (value === 'vault-intelligence-api-key')
                    ? await plugin.geminiService.getApiKey()
                    : value;

                if (actualKey && actualKey.startsWith('AIza')) {
                    try {
                        const app = plugin.app as unknown as InternalApp;
                        const resolveSecret = (key: string) => app.secretStorage.getSecret(key);
                        const resolvedOllamaHeaders = plugin.settings.ollamaHeaders ? await resolveSecrets(plugin.settings.ollamaHeaders, resolveSecret, "ollama-headers-") : {};
                        
                        await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, actualKey, 0, false, false, false, resolvedOllamaHeaders);
                        new Notice("API key valid. Models loaded.");
                    } catch {
                        if (actualKey.length > 30) new Notice("Failed to load models.");
                    }
                }
            }));

        apiSetting.descEl.createDiv({
            cls: 'vi-settings-hint',
            text: `To use a new key, click "${"Link"}" to select or create a secret. Credentials are stored securely and not synced.`
        });
    }

    const statusEl = containerEl.createDiv({ cls: 'vi-ollama-status' });
    const updateStatus = async (url: string) => {
        if (!url) {
            statusEl.setText("");
            return;
        }
        try {
            const endpoint = url.replace(/\/+$/, '');
            const response = await requestUrl({ url: `${endpoint}/api/version` });
            if (response.status === 200) {
                statusEl.setText("Online");
                statusEl.className = 'vi-ollama-status vi-status-success';
            } else {
                statusEl.setText("Offline");
                statusEl.className = 'vi-ollama-status vi-status-error';
            }
        } catch {
            statusEl.setText("Offline");
            statusEl.className = 'vi-ollama-status vi-status-error';
        }
    };

    new Setting(containerEl)
        .setName(`${ollama} endpoint`)
        .setDesc('Server url for local model provider.')
        .addText(text => text
            .setPlaceholder('Enter endpoint (e.g., http://localhost:11434)')
            .setValue(plugin.settings.ollamaEndpoint || '')
            .onChange(async (value) => {
                let url = value.trim();
                if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                    url = `http://${url}`;
                    text.setValue(url);
                }
                plugin.settings.ollamaEndpoint = url;
                await plugin.saveSettings();
            }))
        .addButton(btn => btn
            .setButtonText("Test connection")
            .onClick(async () => {
                btn.setButtonText("Testing...");
                btn.setDisabled(true);
                await updateStatus(plugin.settings.ollamaEndpoint);
                btn.setDisabled(false);
                btn.setButtonText("Test connection");
            }));

    renderKeyValueEditor({
        container: containerEl,
        currentJson: plugin.settings.ollamaHeaders,
        description: "Optional HTTP headers for authentication or proxy configuration. Use 'Secret' to securely store tokens in the device keychain.",
        onChange: (value: string) => {
            plugin.settings.ollamaHeaders = value;
            void plugin.saveSettings();
        },
        onError: (error: string) => new Notice(error),
        onSaveSecret: (key: string, value: string) => {
            const storage = plugin.app.secretStorage as unknown as { setSecret?: (k:string, v:string)=>void };
            if (storage && storage.setSecret) {
                storage.setSecret(key, value);
            }
        },
        secretKeyPrefix: `ollama-headers-`,
        title: "Ollama HTTP headers",
        validateKey: (key: string) => validateHeaderKey(key)
    });

    // --- 3. Model List Management ---
    new Setting(containerEl)
        .setName('Model management')
        .setHeading();

    new Setting(containerEl)
        .setName('Refresh model list')
        .setDesc(`Force a fresh fetch of available models from the ${gemini} API.`)
        .addButton(btn => btn
            .setButtonText("Refresh models")
            .setIcon('refresh-cw')
            .setDisabled(!plugin.settings.googleApiKey)
            .onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText("Refreshing...");
                try {
                    const apiKey = await plugin.geminiService.getApiKey();
                    if (!apiKey) throw new Error("API key not found.");

                    const app = plugin.app as unknown as InternalApp;
                    const resolveSecret = (key: string) => app.secretStorage.getSecret(key);
                    const resolvedOllamaHeaders = plugin.settings.ollamaHeaders ? await resolveSecrets(plugin.settings.ollamaHeaders, resolveSecret, "ollama-headers-") : {};

                    await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, apiKey, 0, true, false, false, resolvedOllamaHeaders);
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
    const fragment = activeDocument.createDocumentFragment();

    const google = "Google";
    const gemini = "Gemini";

    fragment.append(`Enter your ${google} ${gemini} API key.`);

    fragment.createDiv({ cls: 'vault-intelligence-settings-info' }, (div: HTMLDivElement) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-info');
        div.createSpan({}, (textSpan) => {
            textSpan.append('Obtain a key from the ');
            textSpan.createEl('a', {
                href: 'https://console.cloud.google.com/apis/credentials',
                text: `${google} Cloud Console`
            });
            textSpan.append(`. Enable ${gemini} API.`);
        });
    });

    if (storeFailure) {
        fragment.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div: HTMLDivElement) => {
            const iconSpan = div.createSpan();
            setIcon(iconSpan, 'lucide-alert-triangle');
            div.createSpan({}, (textSpan) => {
                textSpan.createEl('strong', { text: 'Security note: ' });
                textSpan.append(`Secure storage is unavailable on this system. Key is stored in plain text in ${configDir}/ folder.`);
            });
            div.createEl('button', { cls: 'mod-cta', text: 'Retry secure storage' }, (btn: HTMLButtonElement) => {
                btn.onclick = () => {
                    void onRetry();
                };
            });
        });
    } else {
        fragment.createDiv({ cls: 'vault-intelligence-settings-success' }, (div: HTMLDivElement) => {
            const iconSpan = div.createSpan();
            setIcon(iconSpan, 'lucide-lock');
            div.createSpan({}, (textSpan: HTMLSpanElement) => {
                textSpan.append('Secure storage is active. Credentials are encrypted by the OS keychain.');
            });
        });
    }

    return fragment;
}
