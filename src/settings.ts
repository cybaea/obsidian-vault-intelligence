/* eslint-disable obsidianmd/ui/sentence-case */
import { App, PluginSettingTab, Setting } from "obsidian";
import VaultIntelligencePlugin from "./main";
import { LogLevel } from "./utils/logger";

export interface VaultIntelligenceSettings {
	googleApiKey: string;
	embeddingModel: string;
	chatModel: string;
	indexingDelayMs: number;
	minSimilarityScore: number;
	geminiRetries: number;
	logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
	googleApiKey: '',
	embeddingModel: 'gemini-embedding-001',
	chatModel: 'gemini-3-flash-preview',
	indexingDelayMs: 200,
	minSimilarityScore: 0.5,
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

		new Setting(containerEl)
			.setName('Google API key')
			.setDesc('Enter your Google Gemini API key')
			.addText(text => text
				.setPlaceholder('API key')
				.setValue(this.plugin.settings.googleApiKey)
				.onChange(async (value) => {
					this.plugin.settings.googleApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Chat model')
			.setDesc('The model to use for chat and research')
			.addText(text => text
				.setPlaceholder('gemini-1.5-flash-preview')
				.setValue(this.plugin.settings.chatModel)
				.onChange(async (value) => {
					this.plugin.settings.chatModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Embedding model')
			.setDesc('The model to use for generating vector embeddings')
			.addText(text => text
				.setPlaceholder('gemini-embedding-001')
				.setValue(this.plugin.settings.embeddingModel)
				.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Indexing delay (ms)')
			.setDesc('Background indexing delay. Lower = faster, but higher risk of rate limiting. Default for free-tier is 4000ms.')
			.addText(text => text
				.setPlaceholder('200')
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
			.setName('Gemini retries')
			.setDesc('Number of times to retry a Gemini API call if it fails (e.g., due to rate limiting)')
			.addText(text => text
				.setPlaceholder('10')
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
			.setDesc('Level of detail for logs in the developer console. Default is warn')
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
}
