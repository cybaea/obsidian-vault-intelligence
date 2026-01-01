import { App } from "obsidian";
import { LogLevel } from "../utils/logger";

export interface VaultIntelligenceSettings {
    googleApiKey: string;
    embeddingModel: string;
    chatModel: string;
    indexingDelayMs: number;
    minSimilarityScore: number;
    similarNotesLimit: number;
    vaultSearchResultsLimit: number;
    geminiRetries: number;
    logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: VaultIntelligenceSettings = {
    googleApiKey: '',
    embeddingModel: 'gemini-embedding-001',
    chatModel: 'gemini-2.0-flash',
    indexingDelayMs: 200,
    minSimilarityScore: 0.5,
    similarNotesLimit: 20,
    vaultSearchResultsLimit: 25,
    geminiRetries: 10,
    logLevel: LogLevel.WARN
};

export interface IVaultIntelligencePlugin {
    app: App;
    settings: VaultIntelligenceSettings;
    saveSettings(): Promise<void>;
}
