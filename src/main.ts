import { Plugin, WorkspaceLeaf, Menu, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, VaultIntelligenceSettings, VaultIntelligenceSettingTab } from "./settings";
import { GeminiService } from "./services/GeminiService";
import { SimilarNotesView, SIMILAR_NOTES_VIEW_TYPE } from "./views/SimilarNotesView";
import { ResearchChatView, RESEARCH_CHAT_VIEW_TYPE } from "./views/ResearchChatView";
import { logger } from "./utils/logger";
import { IEmbeddingService } from "./services/IEmbeddingService";
import { GeminiEmbeddingService } from "./services/GeminiEmbeddingService";
import { LocalEmbeddingService } from "./services/LocalEmbeddingService";
import { VaultManager } from "./services/VaultManager";
import { GraphService } from "./services/GraphService";
import { LOCAL_EMBEDDING_MODELS } from "./services/ModelRegistry";

export default class VaultIntelligencePlugin extends Plugin {
	settings: VaultIntelligenceSettings;
	geminiService: GeminiService;
	embeddingService: IEmbeddingService;
	vaultManager: VaultManager;
	graphService: GraphService;

	private initDebouncedHandlers() {
		// Consistently handled by VectorStore now
	}

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

		// 3. Initialize Graph Infrastructure
		this.vaultManager = new VaultManager(this.app);
		this.graphService = new GraphService(this, this.vaultManager, this.geminiService, this.embeddingService, this.settings);
		await this.graphService.initialize();

		// Background scan for new/changed files
		this.app.workspace.onLayoutReady(async () => {
			await this.graphService.scanAll();
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

		// Register Views
		this.registerView(
			SIMILAR_NOTES_VIEW_TYPE,
			(leaf) => new SimilarNotesView(leaf, this, this.graphService, this.geminiService, this.embeddingService)
		);

		this.registerView(
			RESEARCH_CHAT_VIEW_TYPE,
			(leaf) => new ResearchChatView(leaf, this, this.geminiService, this.graphService, this.embeddingService)
		);

		// Commands
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

		// Event listeners for UI updates
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const leaves = this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
				leaves.forEach(leaf => {
					if (leaf.view instanceof SimilarNotesView) {
						void leaf.view.updateView();
					}
				});
			})
		);

		logger.info("Vault Intelligence Plugin Loaded");
	}

	onunload() {
		if (this.graphService) this.graphService.shutdown();

		if (this.embeddingService instanceof LocalEmbeddingService) {
			this.embeddingService.terminate();
		}

		logger.info("Vault Intelligence Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultIntelligenceSettings>);

		// Sanity check: Ensure dimensions match presets if using a local provider
		if (this.settings.embeddingProvider === 'local') {
			const modelId = this.settings.embeddingModel;
			const modelDef = LOCAL_EMBEDDING_MODELS.find(m => m.id === modelId);

			if (modelDef?.dimensions && this.settings.embeddingDimension !== modelDef.dimensions) {
				logger.warn(`Fixing stale dimension for ${modelDef.label}: ${this.settings.embeddingDimension} -> ${modelDef.dimensions}`);
				this.settings.embeddingDimension = modelDef.dimensions;
				await this.saveData(this.settings);
			}

			// Migration: v1.5 -> v1 (v1.5 seems to be broken/unavailable in Xenova repo)
			if (modelId === 'Xenova/nomic-embed-text-v1.5') {
				const nomicV1 = 'Xenova/nomic-embed-text-v1';
				logger.info(`Migrating model from v1.5 to v1: ${modelId} -> ${nomicV1}`);
				this.settings.embeddingModel = nomicV1;
				this.settings.embeddingDimension = 768;
				await this.saveData(this.settings);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (logger) logger.setLevel(this.settings.logLevel);
		if (this.geminiService) this.geminiService.updateSettings(this.settings);

		this.initDebouncedHandlers();

		if (this.graphService) {
			void this.graphService.updateConfig(this.settings);
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
