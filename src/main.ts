import { Plugin, WorkspaceLeaf, Menu, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, VaultIntelligenceSettings, VaultIntelligenceSettingTab, IVaultIntelligencePlugin } from "./settings";
import { GeminiService } from "./services/GeminiService";
import { SimilarNotesView, SIMILAR_NOTES_VIEW_TYPE } from "./views/SimilarNotesView";
import { ResearchChatView, RESEARCH_CHAT_VIEW_TYPE } from "./views/ResearchChatView";
import { logger } from "./utils/logger";
import { IEmbeddingService } from "./services/IEmbeddingService";
import { VaultManager } from "./services/VaultManager";
import { GraphService } from "./services/GraphService";
import { LOCAL_EMBEDDING_MODELS } from "./services/ModelRegistry";
import { RoutingEmbeddingService } from "./services/RoutingEmbeddingService";
import { MetadataManager } from "./services/MetadataManager";
import { OntologyService } from "./services/OntologyService";
import { GardenerService, GardenerPlanSchema } from "./services/GardenerService";
import { GardenerStateService } from "./services/GardenerStateService";
import { GardenerPlanRenderer } from "./ui/GardenerPlanRenderer";

export default class VaultIntelligencePlugin extends Plugin implements IVaultIntelligencePlugin {
	settings: VaultIntelligenceSettings;
	geminiService: GeminiService;
	embeddingService: IEmbeddingService;
	vaultManager: VaultManager;
	graphService: GraphService;
	metadataManager: MetadataManager;
	ontologyService: OntologyService;
	gardenerService: GardenerService;
	gardenerStateService: GardenerStateService;

	private initDebouncedHandlers() {
		// Consistently handled by VectorStore now
	}

	async onload() {
		await this.loadSettings();

		// Initialize Logger
		logger.setLevel(this.settings.logLevel);

		// 1. Initialize Base Services (Chat/Reasoning always needs Gemini for now)
		this.geminiService = new GeminiService(this.settings);

		// 2. Initialize Routing Embedding Provider
		this.embeddingService = new RoutingEmbeddingService(this, this.geminiService, this.settings);
		if (this.settings.embeddingProvider === 'local') {
			logger.info("Initializing Local Embedding Service");
			void (this.embeddingService as RoutingEmbeddingService).initialize().catch(err => {
				logger.error("Failed to init local worker", err);
			});
		}

		// 3. Initialize Graph Infrastructure
		this.vaultManager = new VaultManager(this.app);
		this.graphService = new GraphService(this, this.vaultManager, this.geminiService, this.embeddingService, this.settings);
		await this.graphService.initialize();

		// 4. Initialize Gardener Infrastructure (Stage 2)
		this.metadataManager = new MetadataManager(this.app);
		this.ontologyService = new OntologyService(this.app, this.settings);
		this.gardenerStateService = new GardenerStateService(this.app);
		this.gardenerService = new GardenerService(this.app, this.geminiService, this.ontologyService, this.settings, this.gardenerStateService);
		await this.ontologyService.initialize();
		await this.gardenerStateService.loadState();

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

		this.addCommand({
			id: 'gardener-tidy-vault',
			name: 'Gardener: tidy vault',
			callback: async () => {
				try {
					const planFile = await this.gardenerService.tidyVault();
					if (planFile) {
						const leaf = this.app.workspace.getLeaf('tab');
						await leaf.openFile(planFile);
					}
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`Gardener failed: ${message}`);
				}
			}
		});

		this.addCommand({
			id: 'gardener-purge-plans',
			name: 'Gardener: purge old plans',
			callback: async () => {
				try {
					await this.gardenerService.purgeOldPlans();
					new Notice("Gardener: old plans purged.");
				} catch (error: unknown) {
					new Notice(`Purge failed: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		});

		// Markdown Post Processors
		this.registerMarkdownCodeBlockProcessor("gardener-plan", (source, el, ctx) => {
			try {
				const rawPlan = JSON.parse(source) as unknown;
				const plan = GardenerPlanSchema.safeParse(rawPlan);

				if (plan.success) {
					const renderer = new GardenerPlanRenderer(this.app, el, plan.data, this.metadataManager, this.ontologyService, this.gardenerStateService);
					ctx.addChild(renderer);
				} else {
					el.createEl("pre", { text: `Invalid Gardener Plan schema: ${plan.error.message}`, cls: "gardener-error" });
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Failed to render Gardener Plan", message);
				el.createEl("pre", { text: `Error parsing Gardener Plan: ${message}`, cls: "gardener-error" });
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

		if (this.embeddingService instanceof RoutingEmbeddingService) {
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
