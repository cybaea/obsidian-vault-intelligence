import { App, Notice, SecretComponent, Setting, requestUrl, setIcon } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { validateHeaderKey } from "../../utils/headers";
import { hasGoogleApiKey, resolveSecrets } from "../../utils/secrets";
import { renderKeyValueEditor } from "../components";
import { refreshSettings } from "../refreshSettings";
import { SettingsTabContext } from "../SettingsTabContext";
import "../components"; // Ensure prototype extensions load
import { BANNER_BASE64 } from "./banner-data";

interface InternalPlugin {
    manifest: {
        name: string;
        id: string;
    };
}

const google = "Google";
const gemini = "Gemini";
const ollama = "Ollama";
const voyage = "Voyage AI";

/**
 * Documentation link setting — opens the plugin documentation site.
 */
export function configureDocumentationField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    const pluginName = (plugin as unknown as InternalPlugin).manifest.name;

    setting
        .setName('Documentation')
        .setDesc(`Learn how to use ${pluginName} and explore advanced features. `)
        .addButton(btn => btn
            .setButtonText("Open documentation")
            .setIcon('external-link')
            .onClick(() => {
                window.open(DOCUMENTATION_URLS.SECTIONS.CONNECTION, '_blank');
            }));
}

/**
 * Google API key setting — supports both SecretStorage (modern) and
 * plain-text fallback (Linux without keyring).
 */
export function configureGoogleApiKeyField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting.setName(`${google} API key`).setClass('vault-intelligence-api-setting');

    if (plugin.settings.secretStorageFailure) {
        // Fallback: Linux with no keyring
        setting.addText(text => {
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
        setting.addComponent(el => new SecretComponent(plugin.app, el)
            .setValue(plugin.settings.googleApiKeySecret || plugin.settings.googleApiKey || '')
            .onChange(async (value) => {
                // Strengthen validation: Google API keys are 39 characters, start with 'AIza', and are alphanumeric
                const isRawKey = value.length === 39 && value.startsWith('AIza') && /^[A-Za-z0-9]+$/.test(value);
                if (isRawKey) {
                    plugin.settings.googleApiKey = value;
                    plugin.settings.googleApiKeySecret = '';
                } else {
                    plugin.settings.googleApiKeySecret = value;
                    plugin.settings.googleApiKey = '';
                }
                await plugin.saveSettings();

                // Warn if input starts with 'AIza' but doesn't match full key format
                if (value.startsWith('AIza') && !isRawKey) {
                    new Notice("Warning: This input starts with 'AIza' but doesn't match the expected Google API key format (39 alphanumeric characters). If this is a raw API key, please verify its format. Otherwise, it will be treated as a secret reference.");
                }

                const actualKey = await plugin.geminiService.getApiKey();
                if (actualKey && actualKey.startsWith('AIza')) {
                    try {
                        const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
                        const resolvedOllamaHeaders = plugin.settings.ollamaHeaders ? await resolveSecrets(plugin.settings.ollamaHeaders, resolveSecret, "ollama-headers-") : {};

                        await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, actualKey, 0, false, false, false, resolvedOllamaHeaders);
                        new Notice("API key valid. Models loaded.");
                    } catch {
                        if (actualKey.length > 30) new Notice("Failed to load models.");
                    }
                }
            }));

        setting.descEl.createDiv({
            cls: 'vi-settings-hint',
            text: `To use a new key, click "${"Link"}" to select or create a secret. Credentials are stored securely and not synced.`
        });
    }
}

/**
 * Ollama endpoint setting — URL input plus a "Test connection" button
 * that probes the Ollama server and shows online/offline status.
 */
export function configureOllamaEndpointField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const { containerEl } = context;

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

    setting
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
}

/**
 * Ollama HTTP headers editor — custom key-value editor for
 * authentication or proxy configuration headers.
 */
export function configureOllamaHeadersField(
    containerEl: HTMLElement,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    renderKeyValueEditor({
        app: plugin.app,
        container: containerEl,
        currentJson: plugin.settings.ollamaHeaders,
        description: "Optional HTTP headers for authentication or proxy configuration. Use 'Secret' to securely store tokens in the device keychain.",
        onChange: (value: string) => {
            plugin.settings.ollamaHeaders = value;
            void plugin.saveSettings();
        },
        onError: (error: string) => new Notice(error),
        onSaveSecret: (key: string, value: string) => {
            const storage = plugin.app.secretStorage as unknown as { setSecret?: (k: string, v: string) => void };
            if (storage && storage.setSecret) {
                storage.setSecret(key, value);
            }
        },
        secretKeyPrefix: `ollama-headers-`,
        title: "Ollama HTTP headers",
        validateKey: (key: string) => validateHeaderKey(key)
    });
}

/**
 * Voyage AI API key setting — supports both SecretStorage (modern) and
 * plain-text fallback (Linux without keyring).
 */
export function configureVoyageApiKeyField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting.setName(`${voyage} API key`).setClass('vault-intelligence-api-setting');

    if (plugin.settings.secretStorageFailure) {
        setting.addText(text => {
            text
                .setPlaceholder('API key')
                .setValue(plugin.settings.voyageApiKey || '')
                .setPassword()
                .onChange(async (value) => {
                    plugin.settings.voyageApiKey = value;
                    await plugin.saveSettings();
                });
        });
    } else {
        setting.addComponent(el => new SecretComponent(plugin.app, el)
            .setValue(plugin.settings.voyageApiKeySecret || plugin.settings.voyageApiKey || '')
            .onChange(async (value) => {
                // Voyage keys start with 'pa-' or 'al-'
                const isRawKey = value.startsWith('pa-') || value.startsWith('al-');
                if (isRawKey) {
                    plugin.settings.voyageApiKey = value;
                    plugin.settings.voyageApiKeySecret = '';
                } else {
                    plugin.settings.voyageApiKeySecret = value;
                    plugin.settings.voyageApiKey = '';
                }
                await plugin.saveSettings();
            }));

        setting.descEl.createDiv({
            cls: 'vi-settings-hint',
            text: `Enter your ${voyage} API key. Obtain it from ${"voyageai.com"}.`
        });
    }
}

/**
 * Refresh model list button — forces a fresh fetch of available models
 * from the Gemini API and refreshes the settings UI.
 */
export function configureRefreshModelListField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Refresh model list')
        .setDesc(`Force a fresh fetch of available models from the ${gemini} API.`)
        .addButton(btn => btn
            .setButtonText("Refresh models")
            .setIcon('refresh-cw')
            .setDisabled(!hasGoogleApiKey(plugin.settings))
            .onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText("Refreshing...");
                try {
                    const apiKey = await plugin.geminiService.getApiKey();
                    if (!apiKey) throw new Error("API key not found.");

                    const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
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
                refreshSettings(context);
            }));
}

export function renderConnectionSettings(context: SettingsTabContext): void {
    const { containerEl, plugin } = context;

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
    configureDocumentationField(new Setting(containerEl), plugin, context);

    // --- 2. API Key Setting ---
    new Setting(containerEl).setName('Connection settings').setHeading()
        .setDesc(getApiKeyDescription(plugin.app, plugin.settings.secretStorageFailure, () => {
            void (async () => {
                plugin.settings.secretStorageFailure = false;
                await plugin.saveSettings();

                const obsidian = "Obsidian";
                new Notice(`Reload ${obsidian} to retry migration.`);

                // Refresh settings UI
                refreshSettings(context);
            })();
        }));

    configureGoogleApiKeyField(new Setting(containerEl), plugin, context);

    configureOllamaEndpointField(new Setting(containerEl), plugin, context);

    configureOllamaHeadersField(containerEl, plugin, context);

    // --- 2b. Voyage AI API Key ---
    configureVoyageApiKeyField(new Setting(containerEl), plugin, context);

    // --- 3. Model List Management ---
    new Setting(containerEl)
        .setName('Model management')
        .setHeading();

    configureRefreshModelListField(new Setting(containerEl), plugin, context);
}

/**
 * Helper for API Key Description
 */
function getApiKeyDescription(app: App, storeFailure: boolean, onRetry: () => void): DocumentFragment {
    const configDir = app.vault.configDir;
    const fragment = createFragment();

    const googleLocal = "Google";
    const geminiLocal = "Gemini";

    fragment.append(`Enter your ${googleLocal} ${geminiLocal} API key.`);

    fragment.createDiv({ cls: 'vault-intelligence-settings-info' }, (div: HTMLDivElement) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-info');
        div.createSpan({}, (textSpan) => {
            textSpan.append('Obtain a key from the ');
            textSpan.createEl('a', {
                href: 'https://console.cloud.google.com/apis/credentials',
                text: `${googleLocal} Cloud Console`
            });
            textSpan.append(`. Enable ${geminiLocal} API.`);
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