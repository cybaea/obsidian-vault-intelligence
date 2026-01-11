import { Setting, SecretComponent, App, setIcon } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";

export function renderConnectionSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Connection').setHeading();

    // --- 1. API Key Setting ---
    const apiKeyDesc = getApiKeyDescription(plugin.app);
    const apiKeySetting = new Setting(containerEl)
        .setName('Google API key')
        .setDesc(apiKeyDesc)
        .setClass('vault-intelligence-api-setting');

    const isSecretComponentAvailable = typeof SecretComponent !== 'undefined';

    if (isSecretComponentAvailable) {
        apiKeySetting.addComponent(el => new SecretComponent(plugin.app, el)
            .setValue(plugin.settings.googleApiKeySecretName)
            .onChange(async (name) => {
                plugin.settings.googleApiKeySecretName = name;
                await plugin.saveSettings();
            })
        );
    } else {
        apiKeySetting.setDesc('Secure storage is not supported in this version of Obsidian (requires 1.11.4+). Your API key will be stored in plain text.');
        apiKeySetting.addText(text => text
            .setPlaceholder('Enter your Google API key')
            .setValue(plugin.settings.googleApiKey || '')
            .onChange(async (value) => {
                plugin.settings.googleApiKey = value;
                await plugin.saveSettings();
            })
        );
    }

}

/**
 * Helper for API Key Description
 */
function getApiKeyDescription(app: App): DocumentFragment {
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

    fragment.createDiv({ cls: 'vault-intelligence-settings-info' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-shield-check');
        div.createSpan({}, (textSpan) => {
            textSpan.createEl('strong', { text: 'Security note: ' });
            textSpan.append(`This key is stored securely in your vault's secret storage. It is not saved in plain text and will not be synced via Obsidian Sync.`);
        });
    });

    return fragment;
}
