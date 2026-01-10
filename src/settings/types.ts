import { App, Platform } from "obsidian";
import { LogLevel } from "../utils/logger";
import { IEmbeddingService } from "../services/IEmbeddingService";

export type EmbeddingProvider = 'gemini' | 'local';

export interface VaultIntelligenceSettings {
    googleApiKey: string;
    // New: Provider Selector
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingDimension: number;
    chatModel: string;
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
    geminiRetries: number;
    embeddingThreads: number;
    logLevel: LogLevel;
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
4. **Style**: Be concise, professional, and use Markdown formatting (bolding, lists) for readability.
`.trim();

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    googleApiKey: '',
    // Default to Gemini for now to preserve existing behavior
    embeddingProvider: 'gemini',
    embeddingModel: 'gemini-embedding-001',
    embeddingDimension: 768,
    chatModel: 'gemini-3-flash-preview',
    groundingModel: 'gemini-2.5-flash-lite',
    codeModel: 'gemini-3-flash-preview',
    enableCodeExecution: false,
    contextWindowTokens: 200000,
    indexingDelayMs: 5000,
    queueDelayMs: 300,
    minSimilarityScore: 0.5,
    similarNotesLimit: 20,
    vaultSearchResultsLimit: 25,
    maxAgentSteps: 5,
    systemInstruction: DEFAULT_SYSTEM_PROMPT,
    geminiRetries: 10,
    embeddingThreads: Platform.isMobile ? 1 : 2,
    logLevel: LogLevel.WARN
};

export interface IVaultIntelligencePlugin {
    app: App;
    settings: VaultIntelligenceSettings;
    embeddingService: IEmbeddingService;
    saveSettings(): Promise<void>;
    vectorStore: {
        reindexVault(): Promise<void>;
    };
}
