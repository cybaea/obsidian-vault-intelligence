import { App, PluginSettingTab, Setting } from "obsidian";
import VaultIntelligencePlugin from "./main";

export interface VaultIntelligenceSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
	mySetting: 'default'
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
			.setName('Settings #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
