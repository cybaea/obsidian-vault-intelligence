import { Plugin, WorkspaceLeaf, Menu, Notice, requestUrl } from 'obsidian';

import { VIEW_TYPES, SANITIZATION_CONSTANTS, UI_STRINGS } from "./constants";
import { ReleaseNotesModal } from "./modals/ReleaseNotesModal";
import { GardenerService, GardenerPlanSchema } from "./services/GardenerService";
import { GardenerStateService } from "./services/GardenerStateService";
import { GeminiService } from "./services/GeminiService";
import { GraphService } from "./services/GraphService";
import { IEmbeddingService } from "./services/IEmbeddingService";
import { MetadataManager } from "./services/MetadataManager";
import { ModelRegistry, LOCAL_EMBEDDING_MODELS } from "./services/ModelRegistry";
import { OntologyService } from "./services/OntologyService";
import { PersistenceManager } from "./services/PersistenceManager";
import { RoutingEmbeddingService } from "./services/RoutingEmbeddingService";
import { VaultManager } from "./services/VaultManager";
import { DEFAULT_SETTINGS, VaultIntelligenceSettings, VaultIntelligenceSettingTab, IVaultIntelligencePlugin } from "./settings";
import { GardenerPlanRenderer } from "./ui/GardenerPlanRenderer";
import { logger } from "./utils/logger";
import { ResearchChatView } from "./views/ResearchChatView";
import { SimilarNotesView } from "./views/SimilarNotesView";

// Legacy prompts for migration detection (v4.2.0)
const LEGACY_SYSTEM_PROMPT = `
Role: You are an intelligent research assistant embedded within the user's Obsidian vault.
Current Date: {{DATE}}

Core Guidelines:
1. **Grounding**: You have access to the user's personal notes. Prioritize their content for questions of the type "What do I know about...".
2. **Verification**: When users ask for facts, ALWAYS verify them against real-world data using 'google_search' unless explicitly told to rely only on notes.
3. **Tool Usage**:
   - Use 'vault_search' to find notes, concepts, and connections.
   - Use 'google_search' for live news, dates, and external fact-checking.
   - Use 'computational_solver' (if available) for math, logic, and data analysis.
   - Use 'read_url' if the user provides a specific link.
4. **Context & Syntax**:
   - The user may reference specific notes using the '@' symbol (e.g., "@Note Name").
   - If the user asks "what is this?", they are referring to the currently open notes.
5. **Efficiency**: Aim to solve the user's request with as few tool calls as possible. Use parallel tool calling for independent searches. If the answer is clear, stop early.
6. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
7. **Strict Metadata Policy**:
   - **NO FRONTMATTER**: Do NOT generate YAML frontmatter (content between --- delimiters) for any reason.
   - **Body Only**: Generate ONLY the Markdown body content. Use a single H1 header (# Title) at the top instead of metadata titles.
8. **Vault Writing Rules**:
   - **Check First**: Before creating a note, check if a similar one exists using 'vault_search'.
   - **File Extensions**: Always append .md to file paths.
   - **Safety**: Do not overwrite existing notes unless explicitly instructed to refactor them. Prefer appending.
`.trim();

const LEGACY_SYSTEM_PROMPT_v4_2_0 = `
Role: You are an intelligent research assistant embedded within the user's Obsidian vault.
Current Date: {{DATE}}

Core Guidelines:
1. **Grounding**: You have access to the user's personal notes. Prioritize their content for questions of the type "What do I know about...".
2. **Verification**: When users ask for facts, ALWAYS verify them against real-world data using 'google_search' unless explicitly told to rely only on notes.
3. **Tool Usage**:
   - Use 'vault_search' to find notes, concepts, and connections.
   - Use 'google_search' for live news, dates, and external fact-checking.
   - Use 'computational_solver' (if available) for math, logic, and data analysis.
   - Use 'read_url' if the user provides a specific link.
4. **Context & Syntax**:
   - The user may reference specific notes using the '@' symbol (e.g., "@Note Name").
   - If the user asks "what is this?", they are referring to the currently open notes.
5. **Efficiency**: Aim to solve the user's request with as few tool calls as possible. Use parallel tool calling for independent searches. If the answer is clear, stop early.
6. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
`.trim();

const LEGACY_GARDENER_SYSTEM_PROMPT = `
You are a Gardener for an Obsidian vault. Your goal is to suggest hygiene improvements for the vault's fluid ontology (represented by the 'topics' frontmatter field).

## YOUR ROLE:
1.  **LINKING**: Identify notes missing relevant topics and suggest adding Markdown links to existing files in the 'VALID TOPICS' list below.
2.  **PROPOSING**: If you identify a recurring theme or concept that doesn't have a topic file yet, suggest a NEW topic as a Markdown link.
    - NEW topics should be placed in one of the following folders if they fit, or you can suggest a path:
{{ONTOLOGY_FOLDERS}}

## THOROUGHNESS:
- You have been provided with **{{NOTE_COUNT}}** notes in the 'NOTES' list below.
- You MUST evaluate **EVERY SINGLE NOTE** individually. 
- Do not limit yourself to a small sample; if multiple notes (or even all of them) require improvements, include them all in your 'actions' array.
- A comprehensive plan is better than a brief one. Your context window is large enough to handle many suggestions.

## CONSTRAINTS:
- Suggestions for 'topics' MUST be standard Markdown links: [Name](/Path/to/file.md).
- DO NOT use double brackets [[ ]] anywhere in the links.
- Use the EXACT vault-absolute paths provided in the 'VALID TOPICS' list below. These paths MUST start with the ontology root folder (e.g., /Ontology/...).
- **NEW TOPICS**: If you suggest a topic that is NOT in the 'VALID TOPICS' list:
    - You MUST provide a clear, concise definition for it.
    - For entities (people, organizations, places) or complex technical concepts, include at least one authoritative reference within the definition.
    - **REFERENCES**: References MUST be formatted as clickable Markdown links (e.g., [Source Name](https://...)) whenever possible. If no URL is available, provide the specific source name.
    - If suggesting multiple similar new topics (e.g. "Risk Management" vs "Enterprise Risk Management"), ensure their definitions clearly distinguish them and explain why they are separate.
    - **CRITICAL**: Check if your proposed concept is already covered by an existing topic or one of its **aliases** in the 'VALID TOPICS' list. If a semantic match exists (even if the name is slightly different), USE THE EXISTING TOPIC LINK instead of proposing a new one.
- ALWAYS provide the full updated array for 'topics'.
- DO NOT suggest changes to 'tags', 'aliases', or any other frontmatter fields. Your scope is strictly limited to the 'topics' field.
- DO NOT link to "Index" files (e.g., Concepts/Concepts.md is an index, use files *inside* it).
- DO NOT suggest removing topics unless they are clearly incorrect or typos.
- Return ONLY valid JSON.
`.trim();

/**
 * Main plugin class for Obsidian Vault Intelligence.
 * Orchestrates services for semantic search, knowledge graph maintenance,
 * and agentic reasoning (Researcher/Gardener).
 */
export default class VaultIntelligencePlugin extends Plugin implements IVaultIntelligencePlugin {
	settings: VaultIntelligenceSettings;
	geminiService: GeminiService;
	embeddingService: IEmbeddingService;
	vaultManager: VaultManager;
	graphService: GraphService;
	persistenceManager: PersistenceManager;
	metadataManager: MetadataManager;
	ontologyService: OntologyService;
	gardenerService: GardenerService;
	gardenerStateService: GardenerStateService;

	private initDebouncedHandlers() {
		// Consistently handled by VectorStore now
	}

	/**
	 * Obsidian plugin lifecycle method called when the plugin is loaded.
	 * Initializes all singleton services and registers UI components.
	 */
	async onload() {
		await this.loadSettings();

		// Check for upgrade and show release notes
		const currentVersion = this.manifest.version;
		if (this.settings.previousVersion !== currentVersion) {
			// Update setting immediately to prevent loop if fetch fails/crashes
			this.settings.previousVersion = currentVersion;
			await this.saveSettings();

			// Trigger fetch/display - fire and forget
			void (async () => {
				const sponsorUrl = await this.getSponsorUrl();
				void this.showReleaseNotes(currentVersion, sponsorUrl);
			})();
		}

		// Initialize Logger
		logger.setLevel(this.settings.logLevel);

		// 1. Initialize Base Services (Chat/Reasoning always needs Gemini for now)
		this.geminiService = new GeminiService(this.settings);

		// 1b. Fetch available models asynchronously
		if (this.settings.googleApiKey) {
			void (async () => {
				await ModelRegistry.fetchModels(this.app, this.settings.googleApiKey, this.settings.modelCacheDurationDays);
				// Re-sanitize after fetch completes in case dynamic limits are different
				await this.sanitizeBudgets();
			})();
		}

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
		this.persistenceManager = new PersistenceManager(this);
		this.graphService = new GraphService(this, this.vaultManager, this.geminiService, this.embeddingService, this.persistenceManager, this.settings);


		// 4. Initialize Gardener Infrastructure (Stage 2)
		this.metadataManager = new MetadataManager(this.app);
		this.ontologyService = new OntologyService(this.app, this.settings);
		this.gardenerStateService = new GardenerStateService(this.app, this);
		this.gardenerService = new GardenerService(this.app, this.geminiService, this.ontologyService, this.settings, this.gardenerStateService);

		// Background scan for new/changed files
		this.app.workspace.onLayoutReady(async () => {
			// Defer heavy initialization until layout is ready to unblock UI
			await this.graphService.initialize();
			await this.ontologyService.initialize();
			await this.gardenerStateService.loadState();

			await this.graphService.scanAll();
		});

		// Ribbon Icon
		this.addRibbonIcon(UI_STRINGS.RIBBON_ICON, UI_STRINGS.RIBBON_TOOLTIP, (evt: MouseEvent) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(UI_STRINGS.RESEARCHER_TITLE)
					.setIcon('message-circle')
					.onClick(() => {
						void this.activateView(VIEW_TYPES.RESEARCH_CHAT);
					})
			);
			menu.addItem((item) =>
				item
					.setTitle(UI_STRINGS.EXPLORER_TITLE)
					.setIcon('layout-grid')
					.onClick(() => {
						void this.activateView(VIEW_TYPES.SIMILAR_NOTES);
					})
			);
			menu.showAtMouseEvent(evt);
		});

		// Register Views
		this.registerView(
			VIEW_TYPES.SIMILAR_NOTES,
			(leaf) => new SimilarNotesView(leaf, this, this.graphService, this.geminiService, this.embeddingService)
		);

		this.registerView(
			VIEW_TYPES.RESEARCH_CHAT,
			(leaf) => new ResearchChatView(leaf, this, this.geminiService, this.graphService, this.embeddingService)
		);

		// Commands
		this.addCommand({
			callback: () => {
				void this.activateView(VIEW_TYPES.SIMILAR_NOTES);
			},
			id: 'open-similar-notes-view',
			name: 'Explorer: view similar notes'
		});

		this.addCommand({
			callback: () => {
				void this.activateView(VIEW_TYPES.RESEARCH_CHAT);
			},
			id: 'open-research-chat-view',
			name: 'Researcher: chat with vault'
		});

		this.addCommand({
			callback: async () => {
				try {
					const planFile = await this.gardenerService.tidyVault();
					if (planFile) {
						const leaf = this.app.workspace.getLeaf('tab');
						await leaf.openFile(planFile);
					}
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`${UI_STRINGS.NOTICE_GARDENER_FAILED}${message}`);
				}
			},
			id: 'gardener-tidy-vault',
			name: UI_STRINGS.GARDENER_TITLE_TIDY
		});

		this.addCommand({
			callback: async () => {
				try {
					await this.gardenerService.purgeOldPlans();
					new Notice(UI_STRINGS.NOTICE_GARDENER_PURGED);
				} catch (error: unknown) {
					new Notice(`${UI_STRINGS.NOTICE_PURGE_FAILED}${error instanceof Error ? error.message : String(error)}`);
				}
			},
			id: 'gardener-purge-plans',
			name: UI_STRINGS.GARDENER_TITLE_PURGE
		});

		this.addCommand({
			callback: async () => {
				const sponsorUrl = await this.getSponsorUrl();
				void this.showReleaseNotes(this.manifest.version, sponsorUrl);
			},
			id: 'show-release-notes',
			name: `Show release notes`
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
					el.createEl("pre", { cls: "gardener-error", text: `Invalid Gardener Plan schema: ${plan.error.message}` });
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Failed to render Gardener Plan", message);
				el.createEl("pre", { cls: "gardener-error", text: `Error parsing Gardener Plan: ${message}` });
			}
		});

		// Settings Tab
		this.addSettingTab(new VaultIntelligenceSettingTab(this.app, this));

		// Event listeners for UI updates
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPES.SIMILAR_NOTES);
				leaves.forEach(leaf => {
					if (leaf.view instanceof SimilarNotesView) {
						void leaf.view.updateView();
					}
				});
			})
		);

		logger.info(UI_STRINGS.NOTICE_PLUGIN_LOADED);
	}

	/**
	 * Obsidian plugin lifecycle method called when the plugin is unloaded.
	 * Ensures clean shutdown of workers and saves final state.
	 */
	onunload() {
		if (this.graphService) {
			void this.graphService.forceSave();
			this.graphService.shutdown();
		}

		if (this.embeddingService instanceof RoutingEmbeddingService) {
			this.embeddingService.terminate();
		}

		logger.info(UI_STRINGS.NOTICE_PLUGIN_UNLOADED);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultIntelligenceSettings>);

		// Migration: Convert Legacy Default Prompts to Reference Mode (null)
		if (this.settings.systemInstruction === LEGACY_SYSTEM_PROMPT || this.settings.systemInstruction === LEGACY_SYSTEM_PROMPT_v4_2_0) {
			logger.info("Migrating legacy system prompt to default-by-reference (null)");
			this.settings.systemInstruction = null;
		}

		if (this.settings.gardenerSystemInstruction === LEGACY_GARDENER_SYSTEM_PROMPT) {
			logger.info("Migrating legacy gardener prompt to default-by-reference (null)");
			this.settings.gardenerSystemInstruction = null;
		}

		await this.sanitizeBudgets();

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
				this.settings.embeddingDimension = SANITIZATION_CONSTANTS.DEFAULT_EMBEDDING_DIMENSION;
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
				await leaf.setViewState({ active: true, type: viewType });
			}
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	/**
	 * Ensures context budgets are within safe safe integer bounds and capped at model limits.
	 * Corrects "silly" values that might be present in data.json.
	 */
	async sanitizeBudgets() {
		let changed = false;

		const sanitize = (val: number, modelId: string, defaultVal: number): number => {
			const limit = ModelRegistry.getModelById(modelId)?.inputTokenLimit ?? SANITIZATION_CONSTANTS.MAX_TOKEN_LIMIT_SANITY;

			// 1. Initial sanity: must be a safe integer
			let cleaned = Number.isSafeInteger(val) ? val : defaultVal;

			// 2. Cap at model limit
			if (cleaned > limit) {
				cleaned = limit;
				changed = true;
			}

			// 3. Floor for usability
			if (cleaned < SANITIZATION_CONSTANTS.MIN_TOKEN_LIMIT) {
				cleaned = SANITIZATION_CONSTANTS.MIN_TOKEN_LIMIT;
				changed = true;
			}

			if (cleaned !== val) changed = true;
			return cleaned;
		};

		this.settings.contextWindowTokens = sanitize(
			this.settings.contextWindowTokens,
			this.settings.chatModel,
			DEFAULT_SETTINGS.contextWindowTokens
		);

		this.settings.gardenerContextBudget = sanitize(
			this.settings.gardenerContextBudget,
			this.settings.gardenerModel,
			DEFAULT_SETTINGS.gardenerContextBudget
		);

		if (changed) {
			logger.info(UI_STRINGS.NOTICE_SANITISED_BUDGETS);
			await this.saveData(this.settings);
		}
	}

	async showReleaseNotes(version: string, sponsorUrl?: string) {
		const repo = "cybaea/obsidian-vault-intelligence";
		const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${version}`;
		const webUrl = `https://github.com/${repo}/releases/tag/${version}`;

		try {
			const response = await requestUrl({ url: apiUrl });

			if (response.status === 200) {
				const data = response.json as { body: string };
				if (data.body) {
					new ReleaseNotesModal(this.app, this, version, data.body, sponsorUrl).open();
				} else {
					throw new Error("Release body empty or not found");
				}
			} else {
				throw new Error("Release body empty or not found");
			}
		} catch (error) {
			logger.error(`Failed to fetch release notes for v${version}`, error);

			// Fallback content with string formatting
			const errorTitle = UI_STRINGS.MODAL_RELEASE_NOTES_ERROR_HEADER;
			const errorBody = UI_STRINGS.MODAL_RELEASE_NOTES_ERROR_BODY
				.replace("{0}", version)
				.replace("{1}", webUrl);

			const fallbackMarkdown = `${errorTitle}\n\n${errorBody}`;

			new ReleaseNotesModal(this.app, this, version, fallbackMarkdown, sponsorUrl).open();
		}
	}

	private async getSponsorUrl(): Promise<string | undefined> {
		try {
			const fundingFile = ".github/FUNDING.yml";
			if (await this.app.vault.adapter.exists(fundingFile)) {
				const content = await this.app.vault.adapter.read(fundingFile);
				const githubLine = content.split("\n").find(line => line.trim().startsWith("github:"));
				if (githubLine) {
					const parts = githubLine.split(":");
					const user = parts[1]?.trim();
					if (user) {
						return `https://github.com/sponsors/${user}`;
					}
				}
			}
		} catch (error) {
			logger.warn("Failed to read FUNDING.yml dynamically", error);
		}
		return undefined;
	}
}
