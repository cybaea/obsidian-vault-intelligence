import { App } from "obsidian";
import { LogLevel } from "../utils/logger";

export interface VaultIntelligenceSettings {
    googleApiKey: string;
    embeddingModel: string;
    chatModel: string;
    groundingModel: string; 
    indexingDelayMs: number;
    minSimilarityScore: number;
    similarNotesLimit: number;
    vaultSearchResultsLimit: number;
    maxAgentSteps: number; 
    geminiRetries: number;
    logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    googleApiKey: '',
    embeddingModel: 'gemini-embedding-001',
    chatModel: 'gemini-3-flash-preview',
    groundingModel: 'gemini-2.5-flash-lite', 
    indexingDelayMs: 200,
    minSimilarityScore: 0.5,
    similarNotesLimit: 20,
    vaultSearchResultsLimit: 25,
    maxAgentSteps: 5, 
    geminiRetries: 10,
    logLevel: LogLevel.WARN
};

export interface IVaultIntelligencePlugin {
    app: App;
    settings: VaultIntelligenceSettings;
    saveSettings(): Promise<void>;
}