import { Plugin, WorkspaceLeaf, TFile, debounce, Menu, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, VaultIntelligenceSettings, VaultIntelligenceSettingTab } from "./settings";
import { GeminiService } from "./services/GeminiService";
import { VectorStore } from "./services/VectorStore";
import { SimilarNotesView, SIMILAR_NOTES_VIEW_TYPE } from "./views/SimilarNotesView";
import { ResearchChatView, RESEARCH_CHAT_VIEW_TYPE } from "./views/ResearchChatView";
import { logger } from "./utils/logger";
import { IEmbeddingService } from "./services/IEmbeddingService";
import { GeminiEmbeddingService } from "./services/GeminiEmbeddingService";
import { LocalEmbeddingService } from "./services/LocalEmbeddingService";

export default class VaultIntelligencePlugin extends Plugin {
	settings: VaultIntelligenceSettings;
	geminiService: GeminiService;
	// Store the interface, not the concrete implementation
	embeddingService: IEmbeddingService;
	vectorStore: VectorStore;

	async onload() {
		await this.loadSettings();

		// Initialize Logger
		logger.setLevel(this.settings.logLevel);

		// 1. Initialize Base Services (Chat/Reasoning always needs Gemini for now)
		this.geminiService = new GeminiService(this.settings);

		// 2. Initialize Embedding Provider based on Settings
		if (this.settings.embeddingProvider === 'local') {
			logger.info("Using Local Embedding Service");
			const localService = new LocalEmbeddingService(this, this.settings);
			// Start the worker early
			void localService.initialize().catch(err => {
				logger.error("Failed to init local worker", err);
				new Notice("Local worker failed to start.");
			});
			this.embeddingService = localService;
		} else {
			logger.info("Using Gemini Embedding Service");
			this.embeddingService = new GeminiEmbeddingService(this.geminiService, this.settings);
		}

		// 3. Inject into VectorStore
		this.vectorStore = new VectorStore(this, this.geminiService, this.embeddingService, this.settings);
		await this.vectorStore.loadVectors();

		// ... (Rest of the file remains the same: Event listeners, Ribbon, Commands) ...

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
			(leaf) => new SimilarNotesView(leaf, this, this.vectorStore, this.geminiService, this.embeddingService)
		);

		this.registerView(
			RESEARCH_CHAT_VIEW_TYPE,
			(leaf) => new ResearchChatView(leaf, this, this.geminiService, this.vectorStore, this.embeddingService)
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
					const leaves = this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
					for (const leaf of leaves) {
						if (leaf.view instanceof SimilarNotesView) {
							void leaf.view.updateForFile(file);
						}
					}
					this.vectorStore.indexFile(file);
				}
			})
		);

		const onMetadataChange = debounce((file: TFile) => {
			if (file instanceof TFile && file.extension === 'md') {
				logger.debug(`File changed (metadata): ${file.path}`);
				this.vectorStore.indexFile(file);

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

		this.registerEvent(this.app.metadataCache.on('changed', onMetadataChange));

		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.vectorStore.indexFile(file);
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile) {
				// @ts-ignore
				this.vectorStore.deleteVector(file.path);
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

		// Cleanup Local Worker if active
		if (this.embeddingService instanceof LocalEmbeddingService) {
			this.embeddingService.terminate();
		}

		logger.info("Vault Intelligence Plugin Unloaded");
	}

	// ... (rest of class: loadSettings, saveSettings, activateView) ...
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultIntelligenceSettings>);

		// Sanity check: Ensure dimensions match presets if using a local provider
		// This fixes "poisoned" settings where a model change didn't update the dimension
		if (this.settings.embeddingProvider === 'local') {
			const { MODELS } = await import("./settings/sections/models");
			if (this.settings.embeddingModel === MODELS.SMALL && this.settings.embeddingDimension !== 256) {
				logger.warn(`Fixing stale dimension for Small model: ${this.settings.embeddingDimension} -> 256`);
				this.settings.embeddingDimension = 256;
				await this.saveData(this.settings);
			} else if (this.settings.embeddingModel === MODELS.BALANCED && this.settings.embeddingDimension !== 384) {
				logger.warn(`Fixing stale dimension for Balanced model: ${this.settings.embeddingDimension} -> 384`);
				this.settings.embeddingDimension = 384;
				await this.saveData(this.settings);
			} else if (this.settings.embeddingModel === MODELS.ADVANCED && this.settings.embeddingDimension !== 768) {
				logger.warn(`Fixing stale dimension for Advanced model: ${this.settings.embeddingDimension} -> 768`);
				this.settings.embeddingDimension = 768;
				await this.saveData(this.settings);
			}

			// Migration: v1.5 -> v1 (v1.5 seems to be broken/unavailable in Xenova repo)
			if (this.settings.embeddingModel === 'Xenova/nomic-embed-text-v1.5') {
				logger.info(`Migrating model from v1.5 to v1: ${this.settings.embeddingModel} -> ${MODELS.ADVANCED}`);
				this.settings.embeddingModel = MODELS.ADVANCED;
				this.settings.embeddingDimension = 768;
				await this.saveData(this.settings);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (logger) logger.setLevel(this.settings.logLevel);
		if (this.geminiService) this.geminiService.updateSettings(this.settings);

		// Note: We don't hot-swap embedding services yet. 
		// The settings tab warns the user to restart if they change providers.

		if (this.vectorStore) {
			this.vectorStore.updateSettings(this.settings);

			// Handle Provider Swap
			const currentProvider = this.settings.embeddingProvider;
			const isLocalActive = this.embeddingService instanceof LocalEmbeddingService;
			const isGeminiActive = this.embeddingService instanceof GeminiEmbeddingService;

			if (currentProvider === 'local' && !isLocalActive) {
				logger.info("Swapping to Local Embedding Service");
				const localService = new LocalEmbeddingService(this, this.settings);
				void localService.initialize().catch(err => logger.error("Failed to init local worker", err));
				this.embeddingService = localService;
				this.vectorStore.setEmbeddingService(localService);
			} else if (currentProvider === 'gemini' && !isGeminiActive) {
				logger.info("Swapping to Gemini Embedding Service");
				if (isLocalActive) {
					(this.embeddingService as LocalEmbeddingService).terminate();
				}
				const geminiService = new GeminiEmbeddingService(this.geminiService, this.settings);
				this.embeddingService = geminiService;
				this.vectorStore.setEmbeddingService(geminiService);
			}

			void this.vectorStore.scanVault();
		}
	}

	async activateView(viewType: string) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			leaf = leaves[0] ?? null;
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: viewType, active: true });
			}
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}
}
