import {
    App,
    ButtonComponent,
    EventRef,
    Events,
    Notice,
    Plugin,
    PluginSettingTab,
    requireApiVersion,
    Setting,
    SettingDefinition,
    SettingDefinitionItem,
    SettingDefinitionRender,
    SettingGroup,
    SettingPage,
} from "obsidian";

import type { IVaultIntelligencePlugin } from "./types";

import { LOCAL_EMBEDDING_MODELS, ModelRegistry } from "../services/ModelRegistry";
import { refreshSettings } from "./refreshSettings";
import {
    configureAllowLocalNetworkAccessField,
    configureEmbeddingChunkSizeField,
    configureFullModelListDebugField,
    configureGeminiApiRetriesField,
    configureModelToggle,
    configureIndexingDelayField,
    configureIndexingThrottleField,
    configureLocalWorkerThreadsField,
    configureLogLevelField,
    configureMaxContextDocumentsField,
    configureModelCacheDurationField,
    configurePrimaryContextThresholdField,
    configureResetTuningField,
    configureSearchCentralityLimitField,
    configureStructuralContextThresholdField,
    configureSupportingContextThresholdField,
    configureTokenEstimationRatioField,
    configureVoyageApiRetriesField,
    renderAdvancedSettings,
} from "./sections/advanced";
import {
    configureDocumentationField,
    configureGoogleApiKeyField,
    configureOllamaEndpointField,
    configureOllamaHeadersField,
    configureRefreshModelListField,
    configureVoyageApiKeyField,
    getApiKeyDescription,
    renderConnectionSettings,
} from "./sections/connections";
import {
    configureCustomEmbeddingModelField,
    configureCustomLocalModelField,
    configureCustomReRankingModelField,
    configureEmbeddingDimensionField,
    configureEmbeddingModelField,
    configureEmbeddingProviderField,
    configureEnableDualLoopField,
    configureImplicitFolderSemanticsField,
    configureKeywordMatchWeightField,
    configureLocalEmbeddingModelField,
    configureLocalModelDimensionsField,
    configureLocalModelStatusField,
    configureMinSimilarityScoreField,
    configureQuantizeLocalModelField,
    configureReIndexVaultField,
    configureReRankingModelField,
    configureSemanticEdgeThicknessField,
    configureSemanticGraphNodeLimitField,
    configureSimilarNotesLimitField,
    configureStructuralEdgeThicknessField,
    renderExplorerSettings,
} from "./sections/explorer";
import {
    configureAddExcludedFolderField,
    configureArchiveFolderPathField,
    configureCustomGardenerModelField,
    configureExcludedFoldersList,
    configureGardenerContextBudgetField,
    configureGardenerModelField,
    configureGardenerPlansPathField,
    configureGardenerRulesField,
    configureOntologyPathField,
    configureOrphanGracePeriodField,
    configurePlansRetentionField,
    configureRecentNoteLimitField,
    configureRecheckCooldownField,
    configureSemanticMergeThresholdField,
    configureSkipRetentionField,
    renderGardenerSettings,
} from "./sections/gardener";
import { renderMcpSettings } from "./sections/mcp";
import {
    configureAuthorNameField,
    configureChatModelField,
    configureCodeExecutionModelField,
    configureContextAwareHeadersField,
    configureContextWindowBudgetField,
    configureCustomChatModelField,
    configureCustomCodeModelField,
    configureCustomLanguageCodeField,
    configureCustomWebSearchModelField,
    configureEnableAgentWriteAccessField,
    configureEnableComputationalSolverField,
    configureEnableLinkContextField,
    configureEnableWebSearchField,
    configureLanguageField,
    configureMaxAgentStepsField,
    configureSystemInstructionField,
    configureVaultReadingLimitField,
    configureWebSearchModelField,
    COMMON_LANGUAGES,
    DEFAULT_LANGUAGE,
    renderResearcherSettings,
} from "./sections/researcher";
import { configurePurgeDataField, configureStorageList, renderStorageSettings } from "./sections/storage";
import { SettingsTabContext } from "./SettingsTabContext";

type TabId = "connections" | "researcher" | "explorer" | "gardener" | "storage" | "mcp" | "advanced";

interface TabDefinition {
    id: TabId;
    label: string;
    render: (context: SettingsTabContext) => void;
}

/**
 * Custom SettingPage for the MCP settings sub-page.
 *
 * Used by the declarative settings engine on Obsidian v1.13.0+ to render
 * the MCP server configuration imperatively (the MCP page uses a `page`
 * factory instead of inline `items` because it has a list↔editor navigation
 * pattern that does not map cleanly to declarative definitions).
 *
 * The class is defined at module level for stable identity. The version
 * guard is at the call site in {@link VaultIntelligenceSettingTab.buildDeclarativeDefinitions}.
 * Defined as a class expression assigned to a const because the
 * `obsidianmd/no-unsupported-api` lint rule only inspects `ClassDeclaration`
 * superclasses for version gating; the actual v1.13 `SettingPage` reference
 * (instantiation) is guarded by `requireApiVersion` at the call site.
 */
const McpSettingPage = class extends SettingPage {
    private readonly plugin: IVaultIntelligencePlugin;
    private readonly app: App;
    private readonly tabInstance: VaultIntelligenceSettingTab;

    constructor(app: App, plugin: IVaultIntelligencePlugin, tabInstance: VaultIntelligenceSettingTab) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.tabInstance = tabInstance;
    }

    override display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const context: SettingsTabContext = {
            app: this.app,
            containerEl,
            plugin: this.plugin,
            tabInstance: this.tabInstance,
        };

        renderMcpSettings(context);
    }
};

export class VaultIntelligenceSettingTab extends PluginSettingTab {
    plugin: IVaultIntelligencePlugin;
    private tabContentMap: Map<TabId, HTMLElement> = new Map();
    private tabButtons: Map<TabId, ButtonComponent> = new Map();
    private lastActiveTabId: TabId | null = null;
    private modelsUpdatedRef: EventRef | undefined;

    constructor(app: App, plugin: IVaultIntelligencePlugin) {
        // We cast to 'Plugin' because the parent class expects the strict Obsidian Plugin type,
        // but we know our interface is compatible at runtime.
        super(app, plugin as unknown as Plugin);
        this.plugin = plugin;

        // When models are fetched asynchronously, rebuild the declarative
        // definitions so the hidden-models list reflects all available models.
        // Guard against undefined workspace (e.g. in test mocks).
        if (this.app.workspace) {
            this.modelsUpdatedRef = (this.app.workspace as Events).on('vault-intelligence:models-updated', () => {
                if (requireApiVersion("1.13.0")) {
                    this.update();
                }
            });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Declarative settings API (Obsidian v1.13.0+)
    // ──────────────────────────────────────────────────────────────

    override getSettingDefinitions(): SettingDefinitionItem[] {
        // Only return definitions on v1.13+; on older versions, Obsidian
        // never calls this method, but the guard ensures correctness.
        if (requireApiVersion("1.13.0")) {
            return this.buildDeclarativeDefinitions();
        }
        return [];
    }

    /**
     * Build the declarative setting definitions for Obsidian v1.13.0+.
     *
     * Called from {@link getSettingDefinitions} inside a
     * `requireApiVersion("1.13.0")` guard. The `McpSettingPage` class is
     * defined at module level (see top of file); the version guard is at
     * the call site (`page: () => new McpSettingPage(...)`).
     */
    private buildDeclarativeDefinitions(): SettingDefinitionItem[] {
        const plugin = this.plugin;

        if (requireApiVersion("1.13.0")) {
            return [
                {
                    desc: 'Configure LLM provider endpoints and private API credentials.',
                    displayValue: () => {
                        if (plugin.settings.googleApiKey || plugin.settings.googleApiKeySecret) return 'Google Gemini';
                        if (plugin.settings.ollamaEndpoint) return 'Ollama';
                        if (plugin.settings.voyageApiKey || plugin.settings.voyageApiKeySecret) return 'Voyage AI';
                        return 'Not configured';
                    },
                    items: this.getConnectionsDefinitions(plugin),
                    name: 'Connections',
                    status: () => {
                        const hasKey = plugin.settings.googleApiKey || plugin.settings.googleApiKeySecret
                            || plugin.settings.ollamaEndpoint || plugin.settings.voyageApiKey || plugin.settings.voyageApiKeySecret;
                        return hasKey ? null : 'warning';
                    },
                    type: 'page',
                },
                {
                    desc: 'Configure chat model, language, context, and agent capabilities.',
                    displayValue: () => plugin.settings.chatModel || 'Not set',
                    items: this.getResearcherDefinitions(plugin),
                    name: 'Researcher',
                    type: 'page',
                },
                {
                    desc: 'Configure embedding models, search ranking, and graph settings.',
                    displayValue: () => plugin.settings.embeddingModel || 'Not set',
                    items: this.getExplorerDefinitions(plugin),
                    name: 'Explorer',
                    status: () => plugin.requiresIndexWipeOnExit === true ? 'warning' : null,
                    type: 'page',
                },
                {
                    desc: 'Configure vault hygiene automation and ontology maintenance.',
                    displayValue: () => plugin.settings.gardenerModel ? 'Configured' : 'Not configured',
                    items: this.getGardenerDefinitions(plugin),
                    name: 'Gardener',
                    type: 'page',
                },
                {
                    desc: 'Manage local vector databases and sharded storage.',
                    displayValue: () => plugin.settings.embeddingModel ? `Shard: ${plugin.settings.embeddingModel}` : 'No active shard',
                    items: this.getStorageDefinitions(plugin),
                    name: 'Storage',
                    type: 'page',
                },
                {
                    desc: 'Configure external MCP server connections.',
                    displayValue: () => {
                        const count = (plugin.settings.mcpServers || []).length;
                        return count > 0 ? `${count} server${count !== 1 ? 's' : ''}` : 'Disabled';
                    },
                    name: 'MCP Tools',
                    page: () => new McpSettingPage(this.app, plugin, this),
                    type: 'page',
                },
                {
                    desc: 'Configure performance tuning, developer options, and security.',
                    items: this.getAdvancedDefinitions(plugin),
                    name: 'Advanced',
                    type: 'page',
                },
            ];
        }
        return [];
    }

    override getControlValue(key: string): unknown {
        const settings = this.plugin.settings;
        if (key in settings) {
            return settings[key as keyof typeof settings];
        }
        return undefined;
    }

    /**
     * Override for Obsidian's declarative settings engine.
     *
     * This method is ONLY invoked by Obsidian for `SettingDefinitionControl`-type
     * definitions (native declarative controls with a `control` field). This
     * implementation uses exclusively `SettingDefinitionRender` entries (custom
     * render closures), so this override is currently a safety net / fallback
     * for potential future native control definitions.
     *
     * The render closures' own `onChange` handlers are the single source of truth
     * for side-effects (deferred-commit flags like `requiresIndexWipeOnExit` and
     * `requiresWorkerRestartOnExit` are set in the section files, not here).
     * This method performs pure persistence: assign the value, save settings.
     *
     * @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings}
     */
    override async setControlValue(key: string, value: unknown): Promise<void> {
        const settings = this.plugin.settings;

        // Type-safe verification that the key exists on our settings object
        if (!(key in settings)) {
            return;
        }

        const settingsKey = key as keyof typeof settings;

        // Perform type-safe assignment.
        // The single cast here is the pragmatic escape hatch for heterogeneous
        // value assignment (string | boolean | number | string[] | Record<...> | null).
        // A fully any-free version would require a generic indexed-write utility
        // or a discriminated-union settings type, which is beyond this issue's scope.
        (settings as unknown as Record<string, unknown>)[settingsKey] = value;

        // Route through our unified save lifecycle instead of raw saveData.
        // No deferred-commit flag interception here — side-effects are owned by
        // the render closures' onChange handlers in the section files.
        await this.plugin.saveSettings();
    }

    // ──────────────────────────────────────────────────────────────
    // Per-page definition builders
    // ──────────────────────────────────────────────────────────────

    private buildContext(plugin: IVaultIntelligencePlugin): SettingsTabContext {
        return {
            app: this.app,
            containerEl: this.containerEl,
            plugin,
            tabInstance: this,
        };
    }

    private getConnectionsDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                heading: 'Connection settings',
                items: [
                    {
                        desc: 'Secure storage is unavailable. Click to retry migration after reloading Obsidian.',
                        name: 'Secure storage status',
                        render: (setting: Setting) => {
                            setting.setDesc(getApiKeyDescription(plugin.app, plugin.settings.secretStorageFailure, () => {
                                void (async () => {
                                    plugin.settings.secretStorageFailure = false;
                                    await plugin.saveSettings();
                                    const obsidian = "Obsidian";
                                    new Notice(`Reload ${obsidian} to retry migration.`);
                                    refreshSettings(context);
                                })();
                            }));
                        },
                        visible: () => plugin.settings.secretStorageFailure === true,
                    },
                    {
                        desc: 'Learn how to use the plugin and explore advanced features.',
                        name: 'Documentation',
                        render: (setting: Setting) => configureDocumentationField(setting, plugin, context),
                    },
                    {
                        aliases: ['credential', 'token', 'secret'],
                        desc: 'Secure credential for connecting to Google Gemini models.',
                        name: 'Google API key',
                        render: (setting: Setting) => configureGoogleApiKeyField(setting, plugin, context),
                    },
                    {
                        aliases: ['url', 'server', 'local model'],
                        desc: 'Server url for local model provider.',
                        name: 'Ollama endpoint',
                        render: (setting: Setting) => configureOllamaEndpointField(setting, plugin, context),
                    },
                    {
                        desc: 'Custom HTTP headers for Ollama API requests.',
                        name: 'Ollama headers',
                        render: (_setting: Setting, group: SettingGroup) => configureOllamaHeadersField(group.listEl, plugin, context),
                    },
                    {
                        desc: 'Secure credential for connecting to Voyage AI models.',
                        name: 'Voyage API key',
                        render: (setting: Setting) => configureVoyageApiKeyField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Model management',
                items: [
                    {
                        desc: 'Force a fresh fetch of available models from the Gemini API.',
                        name: 'Refresh model list',
                        render: (setting: Setting) => configureRefreshModelListField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
        ];
    }

    private getResearcherDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                aliases: ['llm', 'ai', 'engine'],
                desc: 'The main engine used for reasoning and answering questions.',
                name: 'Chat model',
                render: (setting: Setting) => configureChatModelField(setting, plugin, context),
            },
            {
                desc: 'Enter the specific Gemini model ID.',
                name: 'Custom chat model',
                render: (setting: Setting) => configureCustomChatModelField(setting, plugin, context),
                visible: () => this.isCustomChatModel(plugin),
            },
            {
                desc: 'The language the agent should respond in.',
                name: 'Language',
                render: (setting: Setting) => configureLanguageField(setting, plugin, context),
            },
            {
                desc: 'Enter a specific language name or code.',
                name: 'Custom language code',
                render: (setting: Setting) => configureCustomLanguageCodeField(setting, plugin, context),
                visible: () => this.isCustomLanguage(plugin),
            },
            {
                desc: 'Defines the behavior and persona of the agent.',
                name: 'System instruction',
                render: (setting: Setting) => configureSystemInstructionField(setting, plugin, context),
            },
            {
                desc: 'Maximum tokens the agent can use for context.',
                name: 'Context window budget (tokens)',
                render: (setting: Setting) => configureContextWindowBudgetField(setting, plugin, context),
            },
            {
                desc: 'The maximum number of reasoning loops the agent can take.',
                name: 'Max agent steps',
                render: (setting: Setting) => configureMaxAgentStepsField(setting, plugin, context),
            },
            {
                heading: 'Context configuration',
                items: [
                    {
                        desc: 'Name used for queries referring to self.',
                        name: 'Author name',
                        render: (setting: Setting) => configureAuthorNameField(setting, plugin, context),
                    },
                    {
                        desc: 'Comma-separated frontmatter properties to include in semantic context.',
                        name: 'Context aware headers',
                        render: (setting: Setting) => configureContextAwareHeadersField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Capabilities',
                items: [
                    {
                        desc: 'Allows the agent to search the internet for live information.',
                        name: 'Enable web search',
                        render: (setting: Setting) => configureEnableWebSearchField(setting, plugin, context),
                    },
                    {
                        desc: 'Allows Gemini 3.1+ models to natively read and analyze URLs.',
                        name: 'Enable link context',
                        render: (setting: Setting) => configureEnableLinkContextField(setting, plugin, context),
                    },
                    {
                        desc: 'Model used for verifying facts and searching the web.',
                        name: 'Web search model',
                        render: (setting: Setting) => configureWebSearchModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableWebSearch,
                    },
                    {
                        desc: 'Enter the specific Gemini model ID.',
                        name: 'Custom web search model',
                        render: (setting: Setting) => configureCustomWebSearchModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableWebSearch && this.isCustomGroundingModel(plugin),
                    },
                    {
                        desc: 'Allows the agent to write and execute Python code for math and data analysis.',
                        name: 'Enable computational solver',
                        render: (setting: Setting) => configureEnableComputationalSolverField(setting, plugin, context),
                    },
                    {
                        desc: 'Allows the agent to create and update notes in your vault.',
                        name: 'Enable agent write access',
                        render: (setting: Setting) => configureEnableAgentWriteAccessField(setting, plugin, context),
                    },
                    {
                        desc: 'Specific model used for generating Python code.',
                        name: 'Code execution model',
                        render: (setting: Setting) => configureCodeExecutionModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableCodeExecution,
                    },
                    {
                        desc: 'Enter the specific Gemini model ID.',
                        name: 'Custom code model',
                        render: (setting: Setting) => configureCustomCodeModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableCodeExecution && this.isCustomCodeModel(plugin),
                    },
                    {
                        desc: 'Maximum number of notes the researcher can retrieve per question.',
                        name: 'Vault reading limit',
                        render: (setting: Setting) => configureVaultReadingLimitField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
        ];
    }

    private getExplorerDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                aliases: ['vector', 'index'],
                desc: 'Choose which provider generates vector embeddings.',
                name: 'Embedding provider',
                render: (setting: Setting) => configureEmbeddingProviderField(setting, plugin, context),
            },
            {
                desc: 'The specific model used to generate vector embeddings.',
                name: 'Embedding model',
                render: (setting: Setting) => configureEmbeddingModelField(setting, plugin, context),
                visible: () => this.isOnlineEmbeddingProvider(plugin),
            },
            {
                desc: 'Enter the specific embedding model ID.',
                name: 'Custom embedding model',
                render: (setting: Setting) => configureCustomEmbeddingModelField(setting, plugin, context),
                visible: () => this.isOnlineEmbeddingProvider(plugin) && this.isCustomEmbeddingModel(plugin),
            },
            {
                desc: 'The output vector size for the selected embedding model.',
                name: 'Embedding dimension',
                render: (setting: Setting) => configureEmbeddingDimensionField(setting, plugin, context),
                visible: () => this.isOnlineEmbeddingProvider(plugin),
            },
            {
                desc: 'The specific local model used to generate vector embeddings.',
                name: 'Local embedding model',
                render: (setting: Setting) => configureLocalEmbeddingModelField(setting, plugin, context),
                visible: () => plugin.settings.embeddingProvider === 'local',
            },
            {
                desc: 'Enter a HuggingFace model id (must be ONNX compatible).',
                name: 'Custom local model',
                render: (setting: Setting) => configureCustomLocalModelField(setting, plugin, context),
                visible: () => plugin.settings.embeddingProvider === 'local' && this.isCustomLocalModel(plugin),
            },
            {
                desc: 'The output vector size. Incorrect values break search.',
                name: 'Model dimensions',
                render: (setting: Setting) => configureLocalModelDimensionsField(setting, plugin, context),
                visible: () => plugin.settings.embeddingProvider === 'local' && this.isCustomLocalModel(plugin),
            },
            {
                desc: 'Manage the local weights for the selected embedding model.',
                name: 'Local model status',
                render: (setting: Setting) => configureLocalModelStatusField(setting, plugin, context),
                visible: () => plugin.settings.embeddingProvider === 'local',
            },
            {
                desc: 'Enable 8-bit quantization to reduce memory usage and download size.',
                name: 'Quantize local model',
                render: (setting: Setting) => configureQuantizeLocalModelField(setting, plugin, context),
                visible: () => plugin.settings.embeddingProvider === 'local',
            },
            {
                heading: 'Search',
                items: [
                    {
                        aliases: ['rerank', 'reranking', 'two-loop'],
                        desc: 'Combine fast local vector search with deep AI re-ranking for maximum accuracy.',
                        name: 'Enable dual-loop search',
                        render: (setting: Setting) => configureEnableDualLoopField(setting, plugin, context),
                    },
                    {
                        desc: 'The AI engine used for the second loop to verify and rank search results.',
                        name: 'Re-ranking model',
                        render: (setting: Setting) => configureReRankingModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableDualLoop,
                    },
                    {
                        desc: 'Enter the specific Gemini or Ollama model ID.',
                        name: 'Custom re-ranking model',
                        render: (setting: Setting) => configureCustomReRankingModelField(setting, plugin, context),
                        visible: () => plugin.settings.enableDualLoop && this.isCustomReRankingModel(plugin),
                    },
                    {
                        desc: 'Relevance threshold. Results below this are hidden.',
                        name: 'Minimum similarity score',
                        render: (setting: Setting) => configureMinSimilarityScoreField(setting, plugin, context),
                    },
                    {
                        desc: 'Max results displayed in the sidebar.',
                        name: 'Similar notes limit',
                        render: (setting: Setting) => configureSimilarNotesLimitField(setting, plugin, context),
                    },
                    {
                        desc: 'Maximum number of nodes to render in the semantic galaxy view.',
                        name: 'Semantic graph node limit',
                        render: (setting: Setting) => configureSemanticGraphNodeLimitField(setting, plugin, context),
                    },
                    {
                        desc: 'Visual weight of explicit wikilinks in the semantic galaxy.',
                        name: 'Structural edge thickness',
                        render: (setting: Setting) => configureStructuralEdgeThicknessField(setting, plugin, context),
                    },
                    {
                        desc: 'Visual weight of implied AI relationships in the semantic galaxy.',
                        name: 'Semantic edge thickness',
                        render: (setting: Setting) => configureSemanticEdgeThicknessField(setting, plugin, context),
                    },
                    {
                        desc: 'Calibration for keyword vs vector search. Higher values make keyword matches more conservative.',
                        name: 'Keyword match weight',
                        render: (setting: Setting) => configureKeywordMatchWeightField(setting, plugin, context),
                    },
                    {
                        desc: 'Control how folder structure influences semantic analysis.',
                        name: 'Implicit folder semantics',
                        render: (setting: Setting) => configureImplicitFolderSemanticsField(setting, plugin, context),
                    },
                    {
                        desc: 'Wipe and rebuild all embeddings. Required after changing models.',
                        name: 'Re-index vault',
                        render: (setting: Setting) => configureReIndexVaultField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
        ];
    }

    private getGardenerDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                desc: 'The model used for analysis and suggesting improvements.',
                name: 'Gardener model',
                render: (setting: Setting) => configureGardenerModelField(setting, plugin, context),
            },
            {
                desc: 'Enter the specific Gemini model ID.',
                name: 'Custom gardener model',
                render: (setting: Setting) => configureCustomGardenerModelField(setting, plugin, context),
                visible: () => this.isCustomGardenerModel(plugin),
            },
            {
                desc: 'Maximum tokens the gardener can use for context.',
                name: 'Context budget (tokens)',
                render: (setting: Setting) => configureGardenerContextBudgetField(setting, plugin, context),
            },
            {
                desc: 'The base persona and hygiene rules for the gardener.',
                name: 'Gardener rules',
                render: (setting: Setting) => configureGardenerRulesField(setting, plugin, context),
            },
            {
                heading: 'Paths and retention',
                items: [
                    {
                        desc: 'Folder where concepts, entities, and MOCs are stored.',
                        name: 'Ontology path',
                        render: (setting: Setting) => configureOntologyPathField(setting, plugin, context),
                    },
                    {
                        desc: 'Folder where proposed gardener plans are saved.',
                        name: 'Gardener plans path',
                        render: (setting: Setting) => configureGardenerPlansPathField(setting, plugin, context),
                    },
                    {
                        desc: 'Duration to keep plan files before purging.',
                        name: 'Plans retention (days)',
                        render: (setting: Setting) => configurePlansRetentionField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Orphan management',
                items: [
                    {
                        desc: 'Where to move notes that are pruned or deleted by the gardener.',
                        name: 'Archive folder path',
                        render: (setting: Setting) => configureArchiveFolderPathField(setting, plugin, context),
                    },
                    {
                        desc: 'Number of days a note must be unlinked before the gardener suggests pruning it.',
                        name: 'Orphan grace period (days)',
                        render: (setting: Setting) => configureOrphanGracePeriodField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Exclusions',
                items: [
                    {
                        desc: 'Folders ignored by the gardener during analysis. Use the search field to add new exclusions.',
                        name: 'Excluded folders',
                        render: (setting: Setting, _group: SettingGroup) => {
                            // Render both the list and the add-field below the setting's
                            // info row, sharing a single renderFn — matching the
                            // imperative path (gardener.ts:511-513).
                            //
                            // The list is isolated in its own child div so that
                            // renderExcludedFolders (which calls containerEl.empty())
                            // only wipes the list area, not the setting row.
                            const wrapperEl = setting.settingEl.createDiv({ cls: 'vi-excluded-folders' });
                            const excludedFoldersEl = wrapperEl.createDiv();
                            const renderExcludedFolders = configureExcludedFoldersList(excludedFoldersEl, plugin, context);
                            configureAddExcludedFolderField(new Setting(wrapperEl), plugin, context, renderExcludedFolders);
                        },
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Analysis tuning',
                items: [
                    {
                        desc: 'Max number of recent notes to scan for improvements.',
                        name: 'Recent note limit',
                        render: (setting: Setting) => configureRecentNoteLimitField(setting, plugin, context),
                    },
                    {
                        desc: 'Wait duration before re-examining unchanged files.',
                        name: 'Re-check cooldown (days)',
                        render: (setting: Setting) => configureRecheckCooldownField(setting, plugin, context),
                    },
                    {
                        desc: 'How long to remember skipped files.',
                        name: 'Skip retention (days)',
                        render: (setting: Setting) => configureSkipRetentionField(setting, plugin, context),
                    },
                    {
                        desc: 'Similarity score required to merge two isolated topics.',
                        name: 'Semantic merge threshold',
                        render: (setting: Setting) => configureSemanticMergeThresholdField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
        ];
    }

    private getStorageDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                heading: 'Active database shards',
                items: [
                    {
                        desc: 'The plugin stores separate indexes for different embedding models to prevent data corruption.',
                        name: 'Database shards',
                        render: (_setting: Setting, group: SettingGroup) => {
                            // Synchronous execution constraint: the render closure must not
                            // await the async configureStorageList. Paint a skeleton container
                            // synchronously, then fire a floating async promise to populate it.
                            const listContainer = group.listEl.createDiv("vi-storage-list");
                            listContainer.createDiv({ cls: "vi-storage-empty", text: "Loading shards..." });
                            void configureStorageList(listContainer, plugin, context);
                        },
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Maintenance',
                items: [
                    {
                        desc: 'Completely removes all local indexes, cached models, and stored states.',
                        name: 'Purge all data',
                        render: (setting: Setting) => configurePurgeDataField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
        ];
    }

    private getAdvancedDefinitions(plugin: IVaultIntelligencePlugin): SettingDefinitionItem[] {
        const context = this.buildContext(plugin);

        return [
            {
                heading: 'Performance',
                items: [
                    {
                        desc: 'Debounce delay for background indexing while typing.',
                        name: 'Indexing delay (ms)',
                        render: (setting: Setting) => configureIndexingDelayField(setting, plugin, context),
                    },
                    {
                        desc: 'Delay between files during indexing to respect API rate limits.',
                        name: 'Indexing throttle (ms)',
                        render: (setting: Setting) => configureIndexingThrottleField(setting, plugin, context),
                    },
                    {
                        desc: 'Size of text chunks processed by the embedding model.',
                        name: 'Embedding chunk size',
                        render: (setting: Setting) => configureEmbeddingChunkSizeField(setting, plugin, context),
                    },
                    {
                        desc: 'Ratio used to estimate token counts from character counts.',
                        name: 'Token estimation ratio',
                        render: (setting: Setting) => configureTokenEstimationRatioField(setting, plugin, context),
                    },
                    {
                        desc: 'CPU threads used for local embeddings. Higher is faster but heavier.',
                        name: 'Local worker threads',
                        render: (setting: Setting) => configureLocalWorkerThreadsField(setting, plugin, context),
                        visible: () => plugin.settings.embeddingProvider === 'local',
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Gemini system and API',
                items: [
                    {
                        desc: 'Number of retries for spotty connections.',
                        name: 'Gemini API retries',
                        render: (setting: Setting) => configureGeminiApiRetriesField(setting, plugin, context),
                    },
                    {
                        desc: 'How long to cache available Gemini models locally.',
                        name: 'Model cache duration (days)',
                        render: (setting: Setting) => configureModelCacheDurationField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Voyage system and API',
                items: [
                    {
                        desc: 'Number of retries for connections.',
                        name: 'Voyage API retries',
                        render: (setting: Setting) => configureVoyageApiRetriesField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Search and context tuning',
                items: [
                    {
                        desc: 'Score relative to top match required for full file content inclusion.',
                        name: 'Primary context threshold',
                        render: (setting: Setting) => configurePrimaryContextThresholdField(setting, plugin, context),
                    },
                    {
                        desc: 'Score relative to top match required for snippet inclusion.',
                        name: 'Supporting context threshold',
                        render: (setting: Setting) => configureSupportingContextThresholdField(setting, plugin, context),
                    },
                    {
                        desc: 'Score relative to top match required for header inclusion.',
                        name: 'Structural context threshold',
                        render: (setting: Setting) => configureStructuralContextThresholdField(setting, plugin, context),
                    },
                    {
                        desc: 'Max number of bridge nodes to pull in from the graph to expand search context.',
                        name: 'Search centrality limit',
                        render: (setting: Setting) => configureSearchCentralityLimitField(setting, plugin, context),
                    },
                    {
                        desc: 'Safety limit for total number of documents injected into context.',
                        name: 'Max context documents',
                        render: (setting: Setting) => configureMaxContextDocumentsField(setting, plugin, context),
                    },
                    {
                        desc: 'Restore all search and context tuning values to their defaults.',
                        name: 'Reset tuning',
                        render: (setting: Setting) => configureResetTuningField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Developer',
                items: [
                    {
                        desc: 'Console verbosity for debugging.',
                        name: 'Log level',
                        render: (setting: Setting) => configureLogLevelField(setting, plugin, context),
                    },
                    {
                        desc: 'Log raw API response for models to console.',
                        name: 'Full model list debug',
                        render: (setting: Setting) => configureFullModelListDebugField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Security',
                items: [
                    {
                        desc: 'Allows the agent to access localhost and private network IPs.',
                        name: 'Allow local network access (advanced/risky)',
                        render: (setting: Setting) => configureAllowLocalNetworkAccessField(setting, plugin, context),
                    },
                ],
                type: 'group',
            },
            {
                heading: 'Model filtering',
                items: this.getHiddenModelDefinitions(plugin, context),
                search: {
                    match: (def: SettingDefinition, query: string): boolean => {
                        const lowerQuery = query.toLowerCase();
                        const name = def.name?.toLowerCase() ?? '';
                        const desc = typeof def.desc === 'string' ? def.desc.toLowerCase() : '';
                        return name.includes(lowerQuery) || desc.includes(lowerQuery);
                    },
                    placeholder: 'Filter models...',
                },
                type: 'group',
            },
        ];
    }

    private getHiddenModelDefinitions(
        plugin: IVaultIntelligencePlugin,
        _context: SettingsTabContext
    ): SettingDefinitionRender[] {
        const allModels = ModelRegistry.getAllKnownModels();

        if (allModels.length === 0) {
            return [
                {
                    desc: 'Configure a provider and fetch models to filter them.',
                    name: 'No models available',
                    render: (setting: Setting) => {
                        setting.setDisabled(true);
                    },
                },
            ];
        }

        return allModels.map((model): SettingDefinitionRender => ({
            desc: model.id,
            name: model.label,
            render: (setting: Setting) => configureModelToggle(setting, model, plugin),
        }));
    }

    // ──────────────────────────────────────────────────────────────
    // Visibility predicates for conditional fields
    // ──────────────────────────────────────────────────────────────

    private isCustomChatModel(plugin: IVaultIntelligencePlugin): boolean {
        const models = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        const hasApiKey = !!plugin.settings.googleApiKey || !!plugin.settings.googleApiKeySecret;
        const hasOllama = !!plugin.settings.ollamaEndpoint;
        return (hasApiKey || hasOllama) && !models.some(m => m.id === plugin.settings.chatModel);
    }

    private isCustomGroundingModel(plugin: IVaultIntelligencePlugin): boolean {
        const models = ModelRegistry.getGroundingModels(plugin.settings.hiddenModels);
        const hasApiKey = !!plugin.settings.googleApiKey || !!plugin.settings.googleApiKeySecret;
        return hasApiKey && !models.some(m => m.id === plugin.settings.groundingModel);
    }

    private isCustomCodeModel(plugin: IVaultIntelligencePlugin): boolean {
        const models = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        const hasApiKey = !!plugin.settings.googleApiKey || !!plugin.settings.googleApiKeySecret;
        const hasOllama = !!plugin.settings.ollamaEndpoint;
        return (hasApiKey || hasOllama) && !models.some(m => m.id === plugin.settings.codeModel);
    }

    private isCustomGardenerModel(plugin: IVaultIntelligencePlugin): boolean {
        const models = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        const hasApiKey = !!plugin.settings.googleApiKey || !!plugin.settings.googleApiKeySecret;
        const hasOllama = !!plugin.settings.ollamaEndpoint;
        return (hasApiKey || hasOllama) && !models.some(m => m.id === plugin.settings.gardenerModel);
    }

    private isCustomLanguage(plugin: IVaultIntelligencePlugin): boolean {
        const current = plugin.settings.agentLanguage || DEFAULT_LANGUAGE;
        return !COMMON_LANGUAGES.includes(current);
    }

    private isOnlineEmbeddingProvider(plugin: IVaultIntelligencePlugin): boolean {
        const provider = plugin.settings.embeddingProvider;
        return provider === 'gemini' || provider === 'ollama' || provider === 'voyage';
    }

    private isCustomEmbeddingModel(plugin: IVaultIntelligencePlugin): boolean {
        const provider = plugin.settings.embeddingProvider;
        const models = ModelRegistry.getEmbeddingModels(provider);
        const hasApiKey = !!plugin.settings.googleApiKey || !!plugin.settings.googleApiKeySecret;
        const hasOllama = !!plugin.settings.ollamaEndpoint;
        const hasVoyage = !!plugin.settings.voyageApiKey || !!plugin.settings.voyageApiKeySecret;
        const providerEnabled = provider === 'gemini' ? hasApiKey : (provider === 'ollama' ? hasOllama : hasVoyage);
        return providerEnabled && !models.some(m => m.id === plugin.settings.embeddingModel);
    }

    private isCustomLocalModel(plugin: IVaultIntelligencePlugin): boolean {
        return !LOCAL_EMBEDDING_MODELS.some(m => m.id === plugin.settings.embeddingModel);
    }

    private isCustomReRankingModel(plugin: IVaultIntelligencePlugin): boolean {
        const models = ModelRegistry.getChatModels(plugin.settings.hiddenModels);
        return !models.some(m => m.id === plugin.settings.reRankingModel);
    }

    // ──────────────────────────────────────────────────────────────
    // Imperative settings tab (Obsidian v1.12.x and earlier)
    // ──────────────────────────────────────────────────────────────

    override display(): void {
        // On v1.13+, the declarative engine handles rendering; display() is not called.
        // This guard is a safety net for edge cases.
        if (requireApiVersion("1.13.0")) {
            return;
        }

        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("vi-settings-tab-root");

        const tabs: TabDefinition[] = [
            { id: "connections", label: "Connection", render: renderConnectionSettings },
            { id: "researcher", label: "Researcher", render: renderResearcherSettings },
            { id: "explorer", label: "Explorer", render: renderExplorerSettings },
            { id: "gardener", label: "Gardener", render: renderGardenerSettings },
            { id: "storage", label: "Storage", render: (context) => void renderStorageSettings(context) },
            { id: "mcp", label: "MCP Tools", render: renderMcpSettings },
            { id: "advanced", label: "Advanced", render: renderAdvancedSettings },
        ];

        const navEl = containerEl.createDiv("vi-settings-tabs-nav");
        const contentWrapper = containerEl.createDiv("vi-settings-tabs-content");

        // Clear maps on re-display
        this.tabContentMap.clear();
        this.tabButtons.clear();

        tabs.forEach((tab) => {
            const btn = new ButtonComponent(navEl)
                .setButtonText(tab.label)
                .onClick(() => this.activateTab(tab.id, tabs, contentWrapper));

            this.tabButtons.set(tab.id, btn);
        });

        // Activate last active tab or default to first
        const initialTab = this.lastActiveTabId && tabs.some(t => t.id === this.lastActiveTabId)
            ? this.lastActiveTabId
            : "connections";
        this.activateTab(initialTab, tabs, contentWrapper);
    }

    override hide(): void {
        super.hide();
        if (this.modelsUpdatedRef) {
            this.app.workspace.offref(this.modelsUpdatedRef);
        }
        if (this.plugin.requiresIndexWipeOnExit) {
            this.plugin.requiresWorkerRestartOnExit = false;
            this.plugin.requiresIndexWipeOnExit = false;
            void this.plugin.graphSyncOrchestrator?.commitConfigChange(true);
        } else if (this.plugin.requiresWorkerRestartOnExit) {
            this.plugin.requiresWorkerRestartOnExit = false;
            void this.plugin.graphSyncOrchestrator?.commitConfigChange(false);
        }
    }

    private activateTab(id: TabId, tabs: TabDefinition[], contentWrapper: HTMLElement): void {
        const definition = tabs.find(t => t.id === id);
        if (!definition) return;

        // Lazy load content if it doesn't exist
        if (!this.tabContentMap.has(id)) {
            const tabContainer = contentWrapper.createDiv("vi-settings-tab");
            const context: SettingsTabContext = {
                app: this.app,
                containerEl: tabContainer,
                plugin: this.plugin,
                tabInstance: this,
            };
            definition.render(context);
            this.tabContentMap.set(id, tabContainer);
        }

        // Deactivate previous tab
        if (this.lastActiveTabId && this.lastActiveTabId !== id) {
            this.tabContentMap.get(this.lastActiveTabId)?.removeClass("is-active");
            const prevBtn = this.tabButtons.get(this.lastActiveTabId);
            if (prevBtn) {
                prevBtn.buttonEl.removeClass("is-active");
                prevBtn.removeCta();
            }
        }

        // Activate new tab
        this.tabContentMap.get(id)?.addClass("is-active");
        const activeBtn = this.tabButtons.get(id);
        if (activeBtn) {
            activeBtn.buttonEl.addClass("is-active");
            activeBtn.setCta();
        }

        this.lastActiveTabId = id;
    }
}