import { App, Platform } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { IEmbeddingService } from "../services/IEmbeddingService";
import { LogLevel } from "../utils/logger";

export type EmbeddingProvider = 'gemini' | 'local';

export interface VaultIntelligenceSettings {
    chatModel: string;
    codeModel: string;
    contextMaxFiles: number;
    contextPrimaryThreshold: number;
    contextStructuralThreshold: number;
    contextSupportingThreshold: number;
    contextWindowTokens: number;
    embeddingDimension: number;
    embeddingModel: string;
    // New: Provider Selector
    embeddingProvider: EmbeddingProvider;
    embeddingSimd: boolean;
    embeddingThreads: number;
    enableCodeExecution: boolean;
    excludedFolders: string[];
    gardenerContextBudget: number;
    gardenerModel: string;
    gardenerNoteLimit: number;
    gardenerPlansPath: string;
    gardenerRecheckHours: number;
    gardenerSkipRetentionDays: number;
    gardenerSystemInstruction: string;
    garsActivationWeight: number;
    garsCentralityWeight: number;
    garsSimilarityWeight: number;
    geminiRetries: number;
    googleApiKey: string;
    groundingModel: string;
    indexingDelayMs: number;
    logLevel: LogLevel;
    maxAgentSteps: number;
    minSimilarityScore: number;
    modelCacheDurationDays: number;
    ontologyPath: string;
    plansRetentionDays: number;
    previousVersion: string;
    queueDelayMs: number;
    searchCentralityLimit: number;
    searchExpansionSeedsLimit: number;
    searchExpansionThreshold: number;
    similarNotesLimit: number;
    systemInstruction: string;
    vaultSearchResultsLimit: number;
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
5. **Efficiency**: Aim to solve the user's request with as few tool calls as possible. Use parallel tool calling for independent searches. If the answer is clear, stop early.
6. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
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
    chatModel: 'gemini-flash-latest',
    codeModel: 'gemini-flash-latest',
    contextMaxFiles: 100,
    contextPrimaryThreshold: 0.9,
    contextStructuralThreshold: 0.35,
    contextSupportingThreshold: 0.70,
    contextWindowTokens: 200000,
    embeddingDimension: 768,
    embeddingModel: 'gemini-embedding-001',
    // Default to Gemini for now to preserve existing behavior
    embeddingProvider: 'gemini',
    embeddingSimd: !Platform.isMobile,
    embeddingThreads: Platform.isMobile ? 1 : 2,
    enableCodeExecution: true,
    excludedFolders: ['Ontology', 'Gardener/Plans'],
    gardenerContextBudget: 100000,
    gardenerModel: 'gemini-flash-latest',
    gardenerNoteLimit: 10,
    gardenerPlansPath: 'Gardener/Plans',
    gardenerRecheckHours: 24,
    gardenerSkipRetentionDays: 7,
    gardenerSystemInstruction: DEFAULT_GARDENER_SYSTEM_PROMPT,
    garsActivationWeight: GRAPH_CONSTANTS.WEIGHTS.ACTIVATION,
    garsCentralityWeight: GRAPH_CONSTANTS.WEIGHTS.CENTRALITY,
    garsSimilarityWeight: GRAPH_CONSTANTS.WEIGHTS.SIMILARITY,
    geminiRetries: 10,
    googleApiKey: '',
    groundingModel: 'gemini-2.5-flash-lite',
    indexingDelayMs: 5000,
    logLevel: LogLevel.WARN,
    maxAgentSteps: 5,
    minSimilarityScore: 0.5,
    modelCacheDurationDays: 7,
    ontologyPath: 'Ontology',
    plansRetentionDays: 7,
    previousVersion: '0.0.0',
    queueDelayMs: 100,
    searchCentralityLimit: 50,
    searchExpansionSeedsLimit: 5,
    searchExpansionThreshold: 0.7,
    similarNotesLimit: 20,
    systemInstruction: DEFAULT_SYSTEM_PROMPT,
    vaultSearchResultsLimit: 25
};

export interface IVaultIntelligencePlugin {
    app: App;
    embeddingService: IEmbeddingService;
    graphService: {
        scanAll(forceWipe?: boolean): Promise<void>;
    };
    saveSettings(): Promise<void>;
    settings: VaultIntelligenceSettings;
}
