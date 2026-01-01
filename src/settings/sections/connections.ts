import { Setting, TextComponent, App, setIcon } from "obsidian";
import { IVaultIntelligencePlugin } from "../types";

export function renderConnectionSettings(containerEl: HTMLElement, plugin: IVaultIntelligencePlugin): void {
    new Setting(containerEl).setName('Connection').setHeading();

    const apiKeyDesc = getApiKeyDescription(plugin.app);

    // 1. Declare the variable up here so it is available to both blocks below
    let apiTextInput: TextComponent;

    new Setting(containerEl)
        .setName('Google API key')
        .setDesc(apiKeyDesc)
        .setClass('vault-intelligence-api-setting')
        
        // 2. Add the BUTTON FIRST (This puts it on the left, fixing alignment)
        .addExtraButton(btn => {
            btn.setIcon('eye')
               .setTooltip('Show API key')
               .onClick(() => {
                   // By the time the user clicks this, 'apiTextInput' will be defined
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

        // 3. Add the TEXT SECOND (This puts it on the right)
        .addText(text => {
            apiTextInput = text; // Assign the reference here
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
            textSpan.append(`This key is stored in plain text in this plugin's settings within your ${configDir}/ folder. Do not share your vault or commit it to public repositories.`);
        });
    });

    return fragment;
}
