import { App, Platform } from "obsidian";
import { LogLevel } from "../utils/logger";
import { IEmbeddingService } from "../services/IEmbeddingService";
import { GRAPH_CONSTANTS } from "../constants";

export type EmbeddingProvider = 'gemini' | 'local';

export interface VaultIntelligenceSettings {
    googleApiKey: string;
    // New: Provider Selector
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingDimension: number;
    chatModel: string;
    gardenerModel: string;
    groundingModel: string;
    codeModel: string;
    enableCodeExecution: boolean;
    contextWindowTokens: number;
    indexingDelayMs: number;
    queueDelayMs: number;
    minSimilarityScore: number;
    similarNotesLimit: number;
    vaultSearchResultsLimit: number;
    maxAgentSteps: number;
    systemInstruction: string;
    gardenerSystemInstruction: string;
    geminiRetries: number;
    embeddingThreads: number;
    embeddingSimd: boolean;
    logLevel: LogLevel;
    ontologyPath: string;
    gardenerPlansPath: string;
    plansRetentionDays: number;
    gardenerNoteLimit: number;
    gardenerContextBudget: number;
    gardenerRecheckHours: number;
    gardenerSkipRetentionDays: number;
    excludedFolders: string[];
    modelCacheDurationDays: number;
    garsSimilarityWeight: number;
    garsCentralityWeight: number;
    garsActivationWeight: number;
}

// Default System Prompt with {{DATE}} placeholder
const DEFAULT_SYSTEM_PROMPT = `
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
5. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
`.trim();

const DEFAULT_GARDENER_SYSTEM_PROMPT = `
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

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    googleApiKey: '',
    // Default to Gemini for now to preserve existing behavior
    embeddingProvider: 'gemini',
    embeddingModel: 'gemini-embedding-001',
    embeddingDimension: 768,
    chatModel: 'gemini-3-flash-preview',
    gardenerModel: 'gemini-3-flash-preview',
    groundingModel: 'gemini-2.5-flash-lite',
    codeModel: 'gemini-3-flash-preview',
    enableCodeExecution: true,
    contextWindowTokens: 200000,
    indexingDelayMs: 5000,
    queueDelayMs: 300,
    minSimilarityScore: 0.5,
    similarNotesLimit: 20,
    vaultSearchResultsLimit: 25,
    maxAgentSteps: 5,
    systemInstruction: DEFAULT_SYSTEM_PROMPT,
    gardenerSystemInstruction: DEFAULT_GARDENER_SYSTEM_PROMPT,
    geminiRetries: 10,
    embeddingThreads: Platform.isMobile ? 1 : 2,
    embeddingSimd: !Platform.isMobile,
    logLevel: LogLevel.WARN,
    ontologyPath: 'Ontology',
    gardenerPlansPath: 'Gardener/Plans',
    plansRetentionDays: 7,
    gardenerNoteLimit: 10,
    gardenerContextBudget: 100000,
    gardenerRecheckHours: 24,
    gardenerSkipRetentionDays: 7,
    excludedFolders: ['Ontology', 'Gardener/Plans'],
    modelCacheDurationDays: 7,
    garsSimilarityWeight: GRAPH_CONSTANTS.WEIGHTS.SIMILARITY,
    garsCentralityWeight: GRAPH_CONSTANTS.WEIGHTS.CENTRALITY,
    garsActivationWeight: GRAPH_CONSTANTS.WEIGHTS.ACTIVATION
};

export interface IVaultIntelligencePlugin {
    app: App;
    settings: VaultIntelligenceSettings;
    embeddingService: IEmbeddingService;
    saveSettings(): Promise<void>;
    graphService: {
        scanAll(forceWipe?: boolean): Promise<void>;
    };
}
