import { Plugin, WorkspaceLeaf, TFile, debounce, Menu } from 'obsidian';
import { DEFAULT_SETTINGS, VaultIntelligenceSettings, VaultIntelligenceSettingTab } from "./settings";
import { GeminiService } from "./services/GeminiService";
import { VectorStore } from "./services/VectorStore";
import { SimilarNotesView, SIMILAR_NOTES_VIEW_TYPE } from "./views/SimilarNotesView";
import { ResearchChatView, RESEARCH_CHAT_VIEW_TYPE } from "./views/ResearchChatView";
import { logger } from "./utils/logger";

export default class VaultIntelligencePlugin extends Plugin {
	settings: VaultIntelligenceSettings;
	geminiService: GeminiService;
	vectorStore: VectorStore;
	similarNotesView: SimilarNotesView;

	async onload() {
		await this.loadSettings();

		// Initialize Logger
		logger.setLevel(this.settings.logLevel);

		// Initialize Services
		this.geminiService = new GeminiService(this.settings);
		this.vectorStore = new VectorStore(this, this.geminiService, this.settings);
		await this.vectorStore.loadVectors();

		// Background scan for new/changed files
		this.app.workspace.onLayoutReady(() => {
			void this.vectorStore.scanVault();
		});

		// Ribbon Icon
		this.addRibbonIcon('bot', 'Vault intelligence', (evt: MouseEvent) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle('Research chat')
					.setIcon('message-square')
					.onClick(() => {
						void this.activateView(RESEARCH_CHAT_VIEW_TYPE);
					})
			);
			menu.addItem((item) =>
				item
					.setTitle('Similar notes')
					.setIcon('files')
					.onClick(() => {
						void this.activateView(SIMILAR_NOTES_VIEW_TYPE);
					})
			);
			menu.showAtMouseEvent(evt);
		});

		// Register View
		this.registerView(
			SIMILAR_NOTES_VIEW_TYPE,
			(leaf) => new SimilarNotesView(leaf, this, this.vectorStore, this.geminiService)
		);

		this.registerView(
			RESEARCH_CHAT_VIEW_TYPE,
			(leaf) => new ResearchChatView(leaf, this, this.geminiService, this.vectorStore)
		);

		// Activate View Command
		this.addCommand({
			id: 'open-similar-notes-view',
			name: 'Open similar notes view',
			callback: () => {
				void this.activateView(SIMILAR_NOTES_VIEW_TYPE);
			}
		});

		this.addCommand({
			id: 'open-research-chat-view',
			name: 'Open research chat',
			callback: () => {
				void this.activateView(RESEARCH_CHAT_VIEW_TYPE);
			}
		});

		// Settings Tab
		this.addSettingTab(new VaultIntelligenceSettingTab(this.app, this));

		// Event Listeners
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					// 1. Update the sidebar view
					const leaves = this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
					for (const leaf of leaves) {
						if (leaf.view instanceof SimilarNotesView) {
							void leaf.view.updateForFile(file);
						}
					}

					// 2. Index this file if needed (opportunistic indexing)
					this.vectorStore.indexFile(file);
				}
			})
		);

		// File Modification Handling (Debounced)
		const onMetadataChange = debounce((file: TFile) => {
			if (file instanceof TFile && file.extension === 'md') {
				logger.debug(`File changed (metadata): ${file.path}`);
				this.vectorStore.indexFile(file);

				// Update view if it's the active file
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path === file.path) {
					const leaves = this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
					for (const leaf of leaves) {
						if (leaf.view instanceof SimilarNotesView) {
							void leaf.view.updateForFile(file);
						}
					}
				}
			}
		}, 2000, true);

		// More reliable than vault.on('modify') for external changes
		this.registerEvent(this.app.metadataCache.on('changed', onMetadataChange));

		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.vectorStore.indexFile(file);
			}
		}));

		this.registerEvent(this.app.vault.on('delete', async (file) => {
			if (file instanceof TFile) {
				// @ts-ignore - access private for deletion
				await this.vectorStore.deleteVector(file.path);
			}
		}));

		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				await this.vectorStore.renameVector(oldPath, file.path);
			}
		}));

		logger.info("Vault Intelligence Plugin Loaded");
	}

	onunload() {
		if (this.vectorStore) this.vectorStore.destroy();
		logger.info("Vault Intelligence Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultIntelligenceSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update services if needed
		if (logger) logger.setLevel(this.settings.logLevel);
		if (this.geminiService) this.geminiService.updateSettings(this.settings);
		if (this.vectorStore) this.vectorStore.updateSettings(this.settings);
	}

	async activateView(viewType: string) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0] ?? null;
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: viewType, active: true });
			}
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}
}
