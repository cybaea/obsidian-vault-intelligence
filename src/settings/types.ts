import { App, Platform } from "obsidian";

import type { GeminiProvider } from "../services/GeminiProvider";

import { SEARCH_CONSTANTS, GRAPH_CONSTANTS } from "../constants";
import { GraphService } from "../services/GraphService";
import { GraphSyncOrchestrator } from "../services/GraphSyncOrchestrator";
import { PersistenceManager } from "../services/PersistenceManager";
import { IEmbeddingClient } from "../types/providers";
import { LogLevel } from "../utils/logger";

export type EmbeddingProvider = 'gemini' | 'local' | 'ollama';

export type ImplicitFolderSemanticsMode = 'none' | 'ontology' | 'all';

export interface MCPServerConfig {
    args?: string[];
    command?: string;
    enabled: boolean;
    env?: string;
    id: string;
    name: string;
    remoteHeaders?: string;
    requireExplicitConfirmation: boolean;
    type: "stdio" | "sse" | "streamable_http";
    url?: string;
}

export interface VaultIntelligenceSettings {
    agentLanguage: string;
    allowLocalNetworkAccess: boolean;
    authorName: string;
    chatModel: string;
    codeModel: string;
    contextAwareHeaderProperties: string[];
    contextMaxFiles: number;
    contextPrimaryThreshold: number;
    contextStructuralThreshold: number;
    contextSupportingThreshold: number;
    contextWindowTokens: number;
    embeddingChunkSize: number;
    embeddingDimension: number;
    embeddingModel: string;
    embeddingProvider: EmbeddingProvider;
    embeddingSimd: boolean;
    embeddingThreads: number;
    enableAgentWriteAccess: boolean;
    enableCodeExecution: boolean;
    enableDualLoop: boolean;
    enableUrlContext: boolean;
    enableWebSearch: boolean;
    excludedFolders: string[];
    gardenerArchiveFolderPath: string;
    gardenerContextBudget: number;
    gardenerModel: string;
    gardenerNoteLimit: number;
    gardenerOrphanGracePeriodDays: number;
    gardenerPlansPath: string;
    gardenerRecheckDays: number;
    gardenerSemanticMergeThreshold: number;
    gardenerSkipRetentionDays: number;
    gardenerSystemInstruction: string | null;
    geminiRetries: number;
    googleApiKey: string;
    groundingModel: string;
    hiddenModels: string[];
    implicitFolderSemantics: ImplicitFolderSemanticsMode;
    indexingDelayMs: number;
    indexVersion: number;
    keywordWeight: number;
    logLevel: LogLevel;
    maxAgentSteps: number;
    mcpServers: MCPServerConfig[];
    minSimilarityScore: number;
    modelCacheDurationDays: number;
    modelContextOverrides: Record<string, number>;
    ollamaEmbeddingArchitectures: string[] | null;
    ollamaEndpoint: string;
    ontologyPath: string;
    plansRetentionDays: number;
    previousVersion: string;
    queueDelayMs: number;
    reRankingModel: string;
    searchCentralityLimit: number;
    secretStorageFailure: boolean;
    semanticEdgeThickness: number;
    semanticGraphNodeLimit: number;
    similarNotesLimit: number;
    structuralEdgeThickness: number;
    systemInstruction: string | null;
    vaultSearchResultsLimit: number;
}

// Default System Prompt with {{DATE}} placeholder
export const DEFAULT_SYSTEM_PROMPT = `
Role: You are an intelligent research assistant embedded within the user's Obsidian vault.
Current Date: {{DATE}}
Language: Respond in {{LANGUAGE}}.

Core Guidelines:
1. **Grounding**: You have access to the user's personal notes. Prioritize their content for questions of the type "What do I know about...".
    {{VERIFICATION_RULES}}
3. **Tool Usage**:
   - Use 'vault_search' to find notes, concepts, and connections. If 'vault_search' returns no results, state this clearly. Do not invent facts about the user's notes.
   - Use 'google_search' for live news, dates, and external fact-checking.
   - Use 'computational_solver' (if available) for math, logic, and data analysis.
   - Use 'read_url' if the user provides a specific link.
   - Use 'create_note', 'update_note', or 'rename_note' to modify the user's vault documents if they specifically request it. **CRITICAL**: The FULL content to be saved MUST be placed inside the 'content' argument of the tool call. It is not sufficient to output the note content in your chat response.
   - **External Integrations (MCP)**: You may be provided with dynamically injected tools from external servers. If a user's request aligns with the specific capabilities of these tools (such as interacting with external APIs, system information, or external files), prioritize executing them over searching the local vault, as the vault will likely not have live external state.
   - **EXECUTION**: If a tool is needed, invoke it IMMEDIATELY and WITHOUT COMMENTARY. Your text response MUST BE EMPTY when you invoke a tool. Never explain what you are going to do.
   - **ANSWERING**: You are in a direct conversation. When providing your final answer after using tools, address the user as 'you'. UNDER NO CIRCUMSTANCES should you speak in the third person (e.g., NEVER say "The user wants to know..." or "Based on the search results..."). Give the answer directly and conversationally.
4. **Context & Syntax**:
   - The user may reference specific notes using the '@' symbol (e.g., "@Note Name").
   - If the user asks "what is this?", they are referring to the currently open notes.
5. **Efficiency**: Aim to solve the user's request with as few tool calls as possible. Use parallel tool calling for independent searches. If the answer is clear, stop early.
6. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
7. **Strict Metadata Policy**:
   - **NO FRONTMATTER**: Do NOT generate YAML frontmatter. The system handles metadata programmatically; generating it manually will cause data corruption.
   - **Body Only**: Generate ONLY the Markdown body content. Use a single H1 header (# Title) at the top instead of metadata titles.
8. **Vault Writing Rules**:
   - **Reason First**: Before creating a note, explicitly plan your action. Check if a similar note exists using 'vault_search' to avoid duplicates.
   - **File Extensions**: Always append .md to file paths.
    - **Safety**: Do not overwrite existing notes unless explicitly instructed to refactor them. Prefer appending.
`.trim();

export const DEFAULT_GARDENER_SYSTEM_PROMPT = `
You are a Gardener for an Obsidian vault. Your goal is to suggest hygiene improvements for the vault's fluid ontology (represented by the 'topics' frontmatter field).

## YOUR ROLE:
1.  **LINKING**: Identify notes missing relevant topics and suggest adding Markdown links to existing files in the 'VALID TOPICS' list below.
    *CRITICAL: Pay close attention to the note's physical \`path\`. Folders often represent the primary semantic context (e.g., a note in \`/Projects/Apollo\` is structurally about "Projects" and "Apollo").*
2.  **PROPOSING**: If you identify a recurring theme or concept that doesn't have a topic file yet, suggest a NEW topic as a Markdown link.
    - NEW topics should be placed in one of the following folders if they fit, or you can suggest a path:
{{ONTOLOGY_FOLDERS}}

## THOROUGHNESS:
- You have been provided with the notes in the 'NOTES' list below.
- You MUST evaluate **EVERY SINGLE NOTE** individually. 
- Do not limit yourself to a small sample; if multiple notes (or even all of them) require improvements, include them all in your 'actions' array.
- A comprehensive plan is better than a brief one. Your context window is large enough to handle many suggestions.

## CONSTRAINTS:
- Suggestions for 'topics' MUST be standard Markdown links: [Name](/Path/to/file.md).
- DO NOT use double brackets [[ ]] anywhere in the links.
- Use the EXACT vault-absolute paths provided in the 'VALID TOPICS' list below. These paths MUST start with the ontology root folder (e.g., /{{ONTOLOGY_ROOT}}/... (replace with actual root)).
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

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    agentLanguage: 'English (US)',
    allowLocalNetworkAccess: false,
    authorName: 'Me',
    chatModel: 'gemini-flash-latest',
    codeModel: 'gemini-flash-latest',
    contextAwareHeaderProperties: ['title', 'topic', 'tags', 'date', 'author', 'status'],
    contextMaxFiles: SEARCH_CONSTANTS.DEFAULT_CONTEXT_MAX_FILES,
    contextPrimaryThreshold: SEARCH_CONSTANTS.DEFAULT_CONTEXT_PRIMARY_THRESHOLD,
    contextStructuralThreshold: SEARCH_CONSTANTS.DEFAULT_CONTEXT_STRUCTURAL_THRESHOLD,
    contextSupportingThreshold: SEARCH_CONSTANTS.DEFAULT_CONTEXT_SUPPORTING_THRESHOLD,
    contextWindowTokens: 200000,
    embeddingChunkSize: 512,
    embeddingDimension: 768,
    embeddingModel: 'gemini-embedding-001',
    embeddingProvider: 'gemini',
    embeddingSimd: !Platform.isMobile,
    embeddingThreads: Platform.isMobile ? 1 : 2,
    enableAgentWriteAccess: false,
    enableCodeExecution: true,
    enableDualLoop: true,
    enableUrlContext: true,
    enableWebSearch: true,
    excludedFolders: ['Ontology', 'Gardener/Plans'],
    gardenerArchiveFolderPath: 'Ontology/_Archive',
    gardenerContextBudget: 100000,
    gardenerModel: 'gemini-flash-latest',
    gardenerNoteLimit: 10,
    gardenerOrphanGracePeriodDays: 7,
    gardenerPlansPath: 'Gardener/Plans',
    gardenerRecheckDays: 1,
    gardenerSemanticMergeThreshold: 0.85,
    gardenerSkipRetentionDays: 7,
    gardenerSystemInstruction: null, // Use default by reference
    geminiRetries: 10,
    googleApiKey: '',
    groundingModel: 'gemini-flash-lite-latest',
    hiddenModels: [],
    implicitFolderSemantics: 'ontology',
    indexingDelayMs: GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS,
    indexVersion: 7, // 1: Initial... 6: Implicit folder topology, 7: Core URI link unification
    keywordWeight: 1.2,
    logLevel: LogLevel.WARN,
    maxAgentSteps: 5,
    mcpServers: [],
    minSimilarityScore: 0.5,
    modelCacheDurationDays: 7,
    modelContextOverrides: {},
    ollamaEmbeddingArchitectures: null,
    ollamaEndpoint: 'http://localhost:11434',
    ontologyPath: 'Ontology',
    plansRetentionDays: 7,
    previousVersion: '0.0.0',
    queueDelayMs: 100,
    reRankingModel: 'gemini-flash-latest',
    searchCentralityLimit: 50,
    secretStorageFailure: false,
    semanticEdgeThickness: 0.5,
    semanticGraphNodeLimit: 250,
    similarNotesLimit: 20,
    structuralEdgeThickness: 1.0,
    systemInstruction: null, // Use default by reference
    vaultSearchResultsLimit: 25
};

export interface IVaultIntelligencePlugin {
    app: App;
    embeddingService: IEmbeddingClient;
    geminiService: GeminiProvider;
    graphService: GraphService;
    graphSyncOrchestrator: GraphSyncOrchestrator;
    manifest: { id: string; dir?: string };
    mcpClientManager: unknown; // Using unknown here to avoid circular dep, we'll cast it in implementation
    persistenceManager: PersistenceManager;
    requiresIndexWipeOnExit?: boolean;
    requiresWorkerRestartOnExit?: boolean;
    saveSettings(requiresWorkerRestart?: boolean): Promise<void>;
    settings: VaultIntelligenceSettings;
}
