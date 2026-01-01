import { Setting, setIcon, App } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";

export function renderConnectionSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    
    // 1. The Header (We can still use the helper or inline it)
    new Setting(containerEl).setName('Connection').setHeading();

    // 2. The Description Logic
    const apiKeyDesc = getApiKeyDescription(plugin.app);

    // 3. The Setting
    new Setting(containerEl)
        .setName('Google API key')
        .setDesc(apiKeyDesc)
        .setClass('vault-intelligence-api-setting')
        .addText(text => {
            text
                .setPlaceholder('API key')
                .setValue(plugin.settings.googleApiKey)
                .onChange(async (value) => {
                    plugin.settings.googleApiKey = value;
                    await plugin.saveSettings();
                });
            text.inputEl.type = 'password';
        });
}

/**
 * Helper specific to this section
 */
function getApiKeyDescription(app: App): DocumentFragment {
    const configDir = app.vault.configDir;
    const fragment = document.createDocumentFragment();
    
    fragment.append('Enter your Google Gemini API key.');

    // Info Box
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

    // Warning Box
    fragment.createDiv({ cls: 'vault-intelligence-settings-warning' }, (div) => {
        const iconSpan = div.createSpan();
        setIcon(iconSpan, 'lucide-alert-triangle');
        div.createSpan({}, (textSpan) => {
            textSpan.createEl('strong', { text: 'Note: ' });
            textSpan.append(`This key is stored in plain text in your ${configDir}/ folder. Do not share your vault or commit it to public repositories.`);
        });
    });

    return fragment;
}
