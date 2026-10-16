import { App, Notice, SecretComponent, Setting, TextComponent, requestUrl, setIcon } from "obsidian";

import type { IVaultIntelligencePlugin } from "../types";

import { CONNECTION_PRESETS, DOCUMENTATION_URLS } from "../../constants";
import { ModelRegistry } from "../../services/ModelRegistry";
import { validateHeaderKey } from "../../utils/headers";
import { hasGoogleApiKey, resolveSecrets } from "../../utils/secrets";
import { renderKeyValueEditor } from "../components";
import { refreshSettings, refreshVisibility } from "../refreshSettings";
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
const openaiCompat = "OpenAI-compatible";
const voyage = "Voyage AI";
const kilo = "Kilo";
const lmStudio = "LM Studio";
const ollamaCloud = "Ollama Cloud";

const AUTHORIZATION_HEADER = "Authorization";
const PRESET_KILO = "kilo";
const PRESET_NONE = "none";
const PRESET_OLLAMA_CLOUD = "ollama-cloud";
const PRESET_OLLAMA_LOCAL = "ollama-local";
const VI_SECRET_PREFIX = "vi-secret:";

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
                // Obsidian 1.14 emits null when the secret input is cleared; normalise to an empty string so clearing still removes the stored key.
                const keyInput = value ?? '';
                // Strengthen validation: Google API keys are 39 characters, start with 'AIza', and are alphanumeric
                const isRawKey = keyInput.length === 39 && keyInput.startsWith('AIza') && /^[A-Za-z0-9]+$/.test(keyInput);
                if (isRawKey) {
                    plugin.settings.googleApiKey = keyInput;
                    plugin.settings.googleApiKeySecret = '';
                } else {
                    plugin.settings.googleApiKeySecret = keyInput;
                    plugin.settings.googleApiKey = '';
                }
                await plugin.saveSettings();

                // Warn if input starts with 'AIza' but doesn't match full key format
                if (keyInput.startsWith('AIza') && !isRawKey) {
                    new Notice("Warning: This input starts with 'AIza' but doesn't match the expected Google API key format (39 alphanumeric characters). If this is a raw API key, please verify its format. Otherwise, it will be treated as a secret reference.");
                }

                const actualKey = await plugin.geminiService.getApiKey();
                if (actualKey && actualKey.startsWith('AIza')) {
                    try {
                        const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
                        const resolvedOllamaHeaders = plugin.settings.ollamaHeaders ? await resolveSecrets(plugin.settings.ollamaHeaders, resolveSecret, "ollama-headers-") : {};
                        const resolvedOpenAICompatHeaders = plugin.settings.openaiCompatHeaders ? await resolveSecrets(plugin.settings.openaiCompatHeaders, resolveSecret, "openai-compat-headers-") : {};

                        await ModelRegistry.fetchModels(plugin.app, plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`, plugin.settings, actualKey, 0, false, false, false, resolvedOllamaHeaders, false, resolvedOpenAICompatHeaders);
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
    // Render the status badge into the setting row's control area, not the
    // root container. In declarative mode, context.containerEl is the root
    // tab container; rendering there detaches the badge from its setting.
    const statusEl = setting.controlEl.createDiv({ cls: 'vi-ollama-status' });
    const updateStatus = async (url: string) => {
        if (!url) {
            statusEl.setText("");
            return;
        }
        try {
            const endpoint = url.replace(/\/+$/, '');
            // Probe with the resolved connection headers so a configured
            // Ollama Cloud Bearer header is honoured; a missing stored secret
            // resolves to no headers and the 401 below.
            const headers = await resolveConnectionHeaders(plugin, plugin.settings.ollamaHeaders, 'ollama-headers-');
            // throw: false so non-200 probes (e.g. a 401) reach the status check instead of rejecting.
            const response = await requestUrl({ headers, throw: false, url: `${endpoint}/api/version` });
            if (response.status === 200) {
                statusEl.setText("Online");
                statusEl.className = 'vi-ollama-status vi-status-success';
            } else if (response.status === 401 || response.status === 403) {
                statusEl.setText("Unauthorized (check your API key)");
                statusEl.className = 'vi-ollama-status vi-status-error';
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
        .setDesc(`Server url for your ${ollama} connection: a local instance or ${ollamaCloud}.`)
        .addText(text => {
            text
                .setPlaceholder('Enter endpoint (e.g., http://localhost:11434)')
                .setValue(plugin.settings.ollamaEndpoint || '')
                .onChange(async (value) => {
                    // The value is stored as typed (trimmed); the scheme is not
                    // rewritten on every keystroke, which made typed local http://
                    // hosts impossible to enter. Normalization completes on blur.
                    plugin.settings.ollamaEndpoint = value.trim();
                    await plugin.saveSettings();
                });
            normalizeEndpointOnBlur(text, plugin, context, 'ollamaEndpoint');
        })
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
 * Adds (or replaces) the Authorization header with a secret-backed reference.
 * The reference stores the bare header key; resolvers prepend the
 * connection's namespace prefix when reading the keychain.
 */
export function withAuthorizationSecret(currentJson: string | undefined): string {
    let headers: Record<string, string> = {};
    try {
        headers = JSON.parse(currentJson || "{}") as Record<string, string>;
    } catch {
        headers = {};
    }
    headers[AUTHORIZATION_HEADER] = `${VI_SECRET_PREFIX}Authorization`;
    return JSON.stringify(headers);
}

/**
 * Like {@link withAuthorizationSecret}, but for the API key fields: plants
 * the secret-backed Authorization reference only when the stored headers
 * have no Authorization entry yet, so a user-authored header is never
 * clobbered. Returns the updated JSON, or `null` when nothing has to be
 * written (callers then skip the settings save).
 */
export function withAuthorizationSecretIfAbsent(currentJson: string | undefined): string | null {
    let headers: Record<string, string> = {};
    try {
        headers = JSON.parse(currentJson || "{}") as Record<string, string>;
    } catch {
        headers = {};
    }
    if (headers[AUTHORIZATION_HEADER]) {
        return null;
    }
    headers[AUTHORIZATION_HEADER] = `${VI_SECRET_PREFIX}Authorization`;
    return JSON.stringify(headers);
}

/**
 * Normalizes a connection endpoint: trims surrounding whitespace and strips
 * trailing slashes and, when the user typed no scheme, prefixes the scheme
 * the host plausibly serves — `http://` for localhost and private addresses
 * (https would fail TLS against plain local servers), `https://` for the
 * wider web. An explicitly typed scheme always wins.
 *
 * Deliberately not applied on every keystroke: a per-keystroke rewrite makes
 * a typed `http://localhost` host impossible to enter, because the typed
 * `http:` characters are themselves rewritten away.
 */
export function normalizeConnectionEndpoint(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed || /^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    // Bracketed IPv6 literals (for example `[::1]:11434`) must be tested as
    // the bare address; unbracketed hosts take the part before the first
    // port or path separator.
    const bracketed = trimmed.match(/^\[([^\]]+)\]/);
    const host = (bracketed?.[1] ?? trimmed.split(/[/:?]/)[0] ?? '').toLowerCase();
    const isPlainHttpHost = host === 'localhost'
        || host === '::1'
        || host === '0.0.0.0'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || /^(127|10)\./.test(host)
        || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return `${isPlainHttpHost ? 'http' : 'https'}://${trimmed}`;
}

/**
 * Robust visibility comparison for preset endpoints: normalization plus
 * case-insensitive comparison, so a pasted URL with a trailing slash or
 * different casing still matches its preset.
 */
export function isConnectionAtPresetEndpoint(endpoint: string | undefined, presetEndpoint: string): boolean {
    if (!endpoint) {
        return false;
    }
    const normalizeForCompare = (value: string): string => normalizeConnectionEndpoint(value).toLowerCase();
    return normalizeForCompare(endpoint) === normalizeForCompare(presetEndpoint);
}

/**
 * Resolves a connection's stored headers for a connection probe. A missing
 * keychain secret resolves to an empty header set instead of an error: the
 * probing request then simply runs unauthenticated, and its 401 response is
 * reported as "Unauthorized (check your API key)" by the status mapping
 * rather than colliding with the transport-failure "Offline" state.
 */
async function resolveConnectionHeaders(
    plugin: IVaultIntelligencePlugin,
    rawHeaders: string | undefined,
    secretKeyPrefix: string
): Promise<Record<string, string>> {
    if (!rawHeaders) {
        return {};
    }
    const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
    try {
        return await resolveSecrets(rawHeaders, resolveSecret, secretKeyPrefix);
    } catch {
        return {};
    }
}

/**
 * Completes endpoint normalization when the field is left: fills a missing
 * scheme and strips trailing slashes, persists the canonical form, and
 * re-evaluates the visibility predicates (an endpoint edit can show or hide
 * the API key fields). The rebuild fallback is skipped on imperative
 * Obsidian versions because rebuilding the tab would swallow the mouse
 * click that immediately followed the blur; predicates there apply at the
 * next render instead.
 */
function normalizeEndpointOnBlur(
    text: TextComponent,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext,
    settingsKey: 'ollamaEndpoint' | 'openaiCompatEndpoint'
): void {
    text.inputEl.addEventListener('blur', () => {
        void (async () => {
            const normalized = normalizeConnectionEndpoint(text.getValue());
            if (normalized === plugin.settings[settingsKey]) {
                return;
            }
            text.setValue(normalized);
            plugin.settings[settingsKey] = normalized;
            await plugin.saveSettings();
            refreshVisibility(context, { legacyRebuild: false });
        })();
    });
}

/**
 * Applies a connection preset: pins the endpoint on the matching connection
 * and wires a secret-backed Authorization Bearer header where the provider
 * needs an API key.
 */
export async function applyConnectionPreset(presetId: string, plugin: IVaultIntelligencePlugin): Promise<void> {
    let noticeText: string;
    if (presetId === PRESET_OLLAMA_LOCAL) {
        plugin.settings.ollamaEndpoint = CONNECTION_PRESETS.OLLAMA_LOCAL.ENDPOINT;
        noticeText = `${ollama} (local) preset applied: the ${ollama} endpoint is set to ${CONNECTION_PRESETS.OLLAMA_LOCAL.ENDPOINT}.`;
    } else if (presetId === PRESET_OLLAMA_CLOUD) {
        plugin.settings.ollamaEndpoint = CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT;
        plugin.settings.ollamaHeaders = withAuthorizationSecret(plugin.settings.ollamaHeaders);
        noticeText = `${ollamaCloud} preset applied: the ${ollama} endpoint is set to ${CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT}; enter your ${ollamaCloud} API key below.`;
    } else if (presetId === PRESET_KILO) {
        plugin.settings.openaiCompatEndpoint = CONNECTION_PRESETS.KILO.ENDPOINT;
        plugin.settings.openaiCompatHeaders = withAuthorizationSecret(plugin.settings.openaiCompatHeaders);
        noticeText = `${kilo} preset applied: the ${openaiCompat} endpoint is set to ${CONNECTION_PRESETS.KILO.ENDPOINT}; enter your ${kilo} API key below.`;
    } else {
        return;
    }
    new Notice(noticeText);
    await plugin.saveSettings();
}

/**
 * Connection preset dropdown — quick-fills a common provider configuration.
 */
export function configureConnectionPresetField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    setting
        .setName('Connection preset')
        .setDesc('Quickly configure a common provider: sets the endpoint and stores the API key securely where the provider needs one.')
        .addDropdown(dropdown => {
            dropdown.addOption(PRESET_NONE, 'Choose a preset...')
                .addOption(PRESET_OLLAMA_LOCAL, CONNECTION_PRESETS.OLLAMA_LOCAL.LABEL)
                .addOption(PRESET_OLLAMA_CLOUD, CONNECTION_PRESETS.OLLAMA_CLOUD.LABEL)
                .addOption(PRESET_KILO, CONNECTION_PRESETS.KILO.LABEL)
                .setValue(PRESET_NONE)
                .onChange((value) => {
                    void (async () => {
                        await applyConnectionPreset(value, plugin);
                        dropdown.setValue(PRESET_NONE);
                        refreshSettings(context);
                        // Refresh the model list for the pinned endpoint so the
                        // model dropdowns do not sit empty until the user finds
                        // the refresh button themselves. Best effort: failures
                        // surface through the "Test connection" status instead.
                        void refreshModelList(plugin, { tolerateMissingSecrets: true }).catch(() => {
                            // Ignored deliberately: the preset is already applied.
                        });
                    })();
                });
        });
}

/**
 * Ollama Cloud API key — stored in the device keychain and sent as the
 * Authorization Bearer header on every Ollama request. Rendered when the
 * Ollama endpoint points at Ollama Cloud.
 */
export function configureOllamaCloudApiKeyField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName(`${ollama} Cloud API key`)
        .setDesc(`Sent with every request to ${ollamaCloud} and stored in your device keychain; never synced.`)
        .addText(text => text
            .setPlaceholder('API key')
            .setPassword()
            .setValue('')
            .onChange(async (value) => {
                const keyInput = value.trim();
                const storage = plugin.app.secretStorage as unknown as { deleteSecret?: (k: string) => void; setSecret?: (k: string, v: string) => void };
                if (keyInput) {
                    if (storage && storage.setSecret) storage.setSecret(CONNECTION_PRESETS.OLLAMA_CLOUD.SECRET_NAME, keyInput);
                    // Make the field self-sufficient for manually typed endpoints:
                    // wire the stored key into the Authorization header when the
                    // headers have no Authorization entry. The preset path already
                    // plants this reference; a user-authored header is not clobbered.
                    const wired = withAuthorizationSecretIfAbsent(plugin.settings.ollamaHeaders);
                    if (wired !== null) {
                        plugin.settings.ollamaHeaders = wired;
                        await plugin.saveSettings();
                    }
                } else if (storage && storage.deleteSecret) {
                    storage.deleteSecret(CONNECTION_PRESETS.OLLAMA_CLOUD.SECRET_NAME);
                }
            }));
}

/**
 * OpenAI-compatible endpoint setting — URL input plus a "Test connection"
 * button that probes the endpoint's model list and shows online/offline status.
 */
export function configureOpenAICompatEndpointField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    context: SettingsTabContext
): void {
    const statusEl = setting.controlEl.createDiv({ cls: 'vi-ollama-status' });
    const updateStatus = async (url: string) => {
        if (!url) {
            statusEl.setText("");
            return;
        }
        try {
            const endpoint = url.replace(/\/+$/, '');
            const headers = await resolveConnectionHeaders(plugin, plugin.settings.openaiCompatHeaders, 'openai-compat-headers-');
            // throw: false so non-200 probes (e.g. a 401 before the key is set) reach the status check.
            const response = await requestUrl({ headers, throw: false, url: `${endpoint}/models` });
            if (response.status === 200) {
                statusEl.setText("Online");
                statusEl.className = 'vi-ollama-status vi-status-success';
            } else if (response.status === 401 || response.status === 403) {
                statusEl.setText("Unauthorized (check your API key)");
                statusEl.className = 'vi-ollama-status vi-status-error';
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
        .setName(`${openaiCompat} endpoint`)
        .setDesc(`Base url of an ${openaiCompat} API, such as the ${kilo} gateway, ${lmStudio}, vLLM, or llama.cpp. Add the authorization bearer header below or in the headers editor.`)
        .addText(text => {
            text
                .setPlaceholder(`Enter endpoint (e.g., ${CONNECTION_PRESETS.KILO.ENDPOINT})`)
                .setValue(plugin.settings.openaiCompatEndpoint || '')
                .onChange(async (value) => {
                    // The value is stored as typed (trimmed); the scheme is not
                    // rewritten on every keystroke, because an always-https://
                    // rewrite makes the documented http://localhost servers
                    // impossible to enter. Normalization completes on blur.
                    plugin.settings.openaiCompatEndpoint = value.trim();
                    await plugin.saveSettings();
                });
            normalizeEndpointOnBlur(text, plugin, context, 'openaiCompatEndpoint');
        })
        .addButton(btn => btn
            .setButtonText("Test connection")
            .onClick(async () => {
                btn.setButtonText("Testing...");
                btn.setDisabled(true);
                await updateStatus(plugin.settings.openaiCompatEndpoint);
                btn.setDisabled(false);
                btn.setButtonText("Test connection");
            }));
}

/**
 * OpenAI-compatible HTTP headers editor — custom key-value editor for
 * authentication or proxy configuration headers.
 */
export function configureOpenAICompatHeadersField(
    containerEl: HTMLElement,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    renderKeyValueEditor({
        app: plugin.app,
        container: containerEl,
        currentJson: plugin.settings.openaiCompatHeaders,
        description: "Optional HTTP headers for authentication (for example, a Bearer token) or proxy configuration. Use 'Secret' to securely store tokens in the device keychain.",
        onChange: (value: string) => {
            plugin.settings.openaiCompatHeaders = value;
            void plugin.saveSettings();
        },
        onError: (error: string) => new Notice(error),
        onSaveSecret: (key: string, value: string) => {
            const storage = plugin.app.secretStorage as unknown as { setSecret?: (k: string, v: string) => void };
            if (storage && storage.setSecret) {
                storage.setSecret(key, value);
            }
        },
        secretKeyPrefix: `openai-compat-headers-`,
        title: "OpenAI-compatible HTTP headers",
        validateKey: (key: string) => validateHeaderKey(key)
    });
}

/**
 * Kilo API key — stored in the device keychain and sent as the
 * Authorization Bearer header on every OpenAI-compatible request. Rendered
 * when the OpenAI-compatible endpoint points at the Kilo Gateway.
 */
export function configureKiloApiKeyField(
    setting: Setting,
    plugin: IVaultIntelligencePlugin,
    _context: SettingsTabContext
): void {
    setting
        .setName('Kilo API key')
        .setDesc(`Sent with every request to the ${kilo} gateway and stored in your device keychain; never synced.`)
        .addText(text => text
            .setPlaceholder('API key')
            .setPassword()
            .setValue('')
            .onChange(async (value) => {
                const keyInput = value.trim();
                const storage = plugin.app.secretStorage as unknown as { deleteSecret?: (k: string) => void; setSecret?: (k: string, v: string) => void };
                if (keyInput) {
                    if (storage && storage.setSecret) storage.setSecret(CONNECTION_PRESETS.KILO.SECRET_NAME, keyInput);
                    // Make the field self-sufficient for manually typed endpoints:
                    // wire the stored key into the Authorization header when the
                    // headers have no Authorization entry. The preset path already
                    // plants this reference; a user-authored header is not clobbered.
                    const wired = withAuthorizationSecretIfAbsent(plugin.settings.openaiCompatHeaders);
                    if (wired !== null) {
                        plugin.settings.openaiCompatHeaders = wired;
                        await plugin.saveSettings();
                    }
                } else if (storage && storage.deleteSecret) {
                    storage.deleteSecret(CONNECTION_PRESETS.KILO.SECRET_NAME);
                }
            }));
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
                // Obsidian 1.14 emits null when the secret input is cleared; normalise to an empty string so clearing still removes the stored key.
                const keyInput = value ?? '';
                // Voyage keys start with 'pa-' or 'al-'
                const isRawKey = keyInput.startsWith('pa-') || keyInput.startsWith('al-');
                if (isRawKey) {
                    plugin.settings.voyageApiKey = keyInput;
                    plugin.settings.voyageApiKeySecret = '';
                } else {
                    plugin.settings.voyageApiKeySecret = keyInput;
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
 * Fetches the model list across every configured connection (Google Gemini,
 * Ollama, OpenAI-compatible) and refreshes the registry. With `forceUpdate`
 * because the registry caches are not endpoint-keyed, so a changed endpoint
 * must not serve a stale list.
 *
 * A missing Google API key is fine unless `requireGoogleApiKey` is set: the
 * registry falls back to its static model list, so a preset application can
 * refresh the server-based connections without one. When
 * `tolerateMissingSecrets` is set, an unresolvable stored header secret
 * becomes an unauthenticated fetch instead of an error, which the
 * "Test connection" probes surface as 401 instead.
 */
export async function refreshModelList(
    plugin: IVaultIntelligencePlugin,
    options: { requireGoogleApiKey?: boolean; tolerateMissingSecrets?: boolean } = {}
): Promise<void> {
    // getApiKey can return null; fetchModels handles a falsy key by falling back to its static model list.
    const apiKey = (await plugin.geminiService.getApiKey()) || '';
    if (!apiKey && options.requireGoogleApiKey) {
        throw new Error("API key not found.");
    }
    const resolveSecret = (key: string) => plugin.app.secretStorage.getSecret(key);
    const resolveHeaders = async (raw: string | undefined, secretKeyPrefix: string): Promise<Record<string, string>> => {
        if (!raw) return {};
        if (options.tolerateMissingSecrets) {
            try {
                return await resolveSecrets(raw, resolveSecret, secretKeyPrefix);
            } catch {
                // Best effort: a missing stored secret is surfaced by the
                // connection probes instead of failing the whole refresh.
                return {};
            }
        }
        return resolveSecrets(raw, resolveSecret, secretKeyPrefix);
    };
    const ollamaHeaders = await resolveHeaders(plugin.settings.ollamaHeaders, `ollama-headers-`);
    const openaiCompatHeaders = await resolveHeaders(plugin.settings.openaiCompatHeaders, `openai-compat-headers-`);

    await ModelRegistry.fetchModels(
        plugin.app,
        plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/vault-intelligence`,
        plugin.settings,
        apiKey,
        0,
        true,
        false,
        false,
        ollamaHeaders,
        false,
        openaiCompatHeaders
    );
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
                    await refreshModelList(plugin, { requireGoogleApiKey: true });
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

    configureConnectionPresetField(new Setting(containerEl), plugin, context);

    configureOllamaEndpointField(new Setting(containerEl), plugin, context);

    if (isConnectionAtPresetEndpoint(plugin.settings.ollamaEndpoint, CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT)) {
        configureOllamaCloudApiKeyField(new Setting(containerEl), plugin, context);
    }

    configureOllamaHeadersField(containerEl, plugin, context);

    configureOpenAICompatEndpointField(new Setting(containerEl), plugin, context);

    if (isConnectionAtPresetEndpoint(plugin.settings.openaiCompatEndpoint, CONNECTION_PRESETS.KILO.ENDPOINT)) {
        configureKiloApiKeyField(new Setting(containerEl), plugin, context);
    }

    configureOpenAICompatHeadersField(containerEl, plugin, context);

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
export function getApiKeyDescription(app: App, storeFailure: boolean, onRetry: () => void): DocumentFragment {
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