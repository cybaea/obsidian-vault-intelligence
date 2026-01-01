import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import VaultIntelligencePlugin from "./main";
import { LogLevel } from "./utils/logger";

export interface VaultIntelligenceSettings {
    googleApiKey: string;
    embeddingModel: string;
    chatModel: string;
    indexingDelayMs: number;
    minSimilarityScore: number;
    similarNotesLimit: number;
    vaultSearchResultsLimit: number;
    geminiRetries: number;
    logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    googleApiKey: '',
    embeddingModel: 'gemini-embedding-001',
    chatModel: 'gemini-2.0-flash', // Updated to latest stable or preview
    indexingDelayMs: 200,
    minSimilarityScore: 0.5,
    similarNotesLimit: 20,
    vaultSearchResultsLimit: 25,
    geminiRetries: 10,
    logLevel: LogLevel.WARN
}

export class VaultIntelligenceSettingTab extends PluginSettingTab {
    plugin: VaultIntelligencePlugin;

    constructor(app: App, plugin: VaultIntelligencePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // The display method now acts as a "Table of Contents"
        this.renderConnectionSettings(containerEl);
        this.renderModelSettings(containerEl);
        this.renderIndexingSettings(containerEl);
        this.renderAdvancedSettings(containerEl);
    }

    /**
     * SECTION 1: API Connection & Credentials
     */
    private renderConnectionSettings(containerEl: HTMLElement): void {
        this.createHeader(containerEl, 'Connection');

        const apiKeyDesc = this.getApiKeyDescription();

        new Setting(containerEl)
            .setName('Google API key')
            .setDesc(apiKeyDesc)
            .setClass('vault-intelligence-api-setting')
            .addText(text => {
                text
                    .setPlaceholder('API key')
                    .setValue(this.plugin.settings.googleApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.googleApiKey = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });
    }

    /**
     * SECTION 2: AI Models
     */
    private renderModelSettings(containerEl: HTMLElement): void {
        this.createHeader(containerEl, 'AI Models');

        new Setting(containerEl)
            .setName('Chat model')
            .setDesc('The model to use for chat and research.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.chatModel)
                .setValue(this.plugin.settings.chatModel)
                .onChange(async (value) => {
                    this.plugin.settings.chatModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Embedding model')
            .setDesc('The model to use for generating vector embeddings.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
                .setValue(this.plugin.settings.embeddingModel)
                .onChange(async (value) => {
                    this.plugin.settings.embeddingModel = value;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * SECTION 3: RAG & Indexing Performance
     */
    private renderIndexingSettings(containerEl: HTMLElement): void {
        this.createHeader(containerEl, 'Indexing & Search');

        new Setting(containerEl)
            .setName('Indexing delay (ms)')
            .setDesc('Background indexing delay. Lower = faster, but higher risk of rate limiting.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.indexingDelayMs))
                .setValue(String(this.plugin.settings.indexingDelayMs))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num)) {
                        this.plugin.settings.indexingDelayMs = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Minimum similarity score')
            .setDesc('Only notes with a similarity score above this threshold will be shown.')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.minSimilarityScore)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.minSimilarityScore = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Similar notes limit')
            .setDesc('Maximum number of similar notes to show in the sidebar.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.similarNotesLimit))
                .setValue(String(this.plugin.settings.similarNotesLimit))
                .onChange(async (value) => {
                    const num = parseInt(value); // Changed to parseInt for simplicity unless you need floats
                    if (!isNaN(num) && num >= 0) {
                         this.plugin.settings.similarNotesLimit = num;
                         await this.plugin.saveSettings();
                    }
                }));
        
        new Setting(containerEl)
            .setName('Vault search results limit')
            .setDesc('Maximum number of results returned by the vault search tool.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.vaultSearchResultsLimit))
                .setValue(String(this.plugin.settings.vaultSearchResultsLimit))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.vaultSearchResultsLimit = num;
                        await this.plugin.saveSettings();
                    }
                }));
    }

    /**
     * SECTION 4: Advanced / Developer
     */
    private renderAdvancedSettings(containerEl: HTMLElement): void {
        this.createHeader(containerEl, 'Advanced');

        new Setting(containerEl)
            .setName('Gemini retries')
            .setDesc('Number of times to retry a Gemini API call if it fails.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.geminiRetries))
                .setValue(String(this.plugin.settings.geminiRetries))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.geminiRetries = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Log level')
            .setDesc('Level of detail for logs in the developer console.')
            .addDropdown(dropdown => dropdown
                .addOption(String(LogLevel.DEBUG), 'Debug')
                .addOption(String(LogLevel.INFO), 'Info')
                .addOption(String(LogLevel.WARN), 'Warn')
                .addOption(String(LogLevel.ERROR), 'Error')
                .setValue(String(this.plugin.settings.logLevel))
                .onChange(async (value) => {
                    this.plugin.settings.logLevel = parseInt(value) as LogLevel;
                    await this.plugin.saveSettings();
                }));
    }

	/**
     * HELPER: Create a visual header to separate sections
     */
    private createHeader(containerEl: HTMLElement, title: string): void {
        new Setting(containerEl)
            .setName(title)
            .setHeading();
    }

    /**
     * HELPER: Generate the complex API Key description fragment
     */
    private getApiKeyDescription(): DocumentFragment {
        const configDir = this.app.vault.configDir;
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
}