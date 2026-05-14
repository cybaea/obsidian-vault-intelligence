import { App, Notice, requestUrl } from "obsidian";

import { RETRY_CONSTANTS, SEARCH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { EmbeddingPriority, IEmbeddingClient, ProviderError } from "../types/providers";
import { logger } from "../utils/logger";
import { getVoyageApiKeySecretName, hasVoyageApiKey } from "../utils/secrets";

interface VoyageResponse {
    data: { embedding: number[]; index: number }[];
    model: string;
    usage: { total_tokens: number };
}

interface InternalSecretStorage {
    getSecret(key: string): string | null;
}

const VOYAGE_TOKEN_LIMITS: Record<string, number> = {
    'voyage/voyage-4': 320000,
    'voyage/voyage-4-large': 120000,
    'voyage/voyage-4-lite': 1000000,
};

const DEFAULT_LIMIT = 320000;

export class VoyageAIProvider implements IEmbeddingClient {
    private settings: VaultIntelligenceSettings;
    private app: App;

    constructor(settings: VaultIntelligenceSettings, app: App) {
        this.settings = settings;
        this.app = app;
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
    }

    private async getApiKey(): Promise<string | null> {
        const rawKey = this.settings.voyageApiKey?.trim();
        const secretKey = getVoyageApiKeySecretName(this.settings);

        if (!rawKey && !secretKey) return null;

        // Voyage keys start with pa- or al-
        if (this.settings.secretStorageFailure || (rawKey && (rawKey.startsWith('pa-') || rawKey.startsWith('al-')))) {
            return rawKey || null;
        }

        if (secretKey) {
            try {
                const storage = this.app.secretStorage as unknown as InternalSecretStorage | undefined;
                if (storage && storage.getSecret) {
                    return Promise.resolve(storage.getSecret(secretKey));
                }
                return null;
            } catch (error) {
                logger.error("Failed to retrieve Voyage secret from storage:", error);
                return null;
            }
        }

        return null;
    }

    public isReady(): boolean {
        return hasVoyageApiKey(this.settings) && !this.settings.secretStorageFailure;
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    public async embedQuery(text: string, _priority?: EmbeddingPriority): Promise<{ tokenCount: number; vector: number[] }> {
        const response = await this.requestEmbeddings([text], 'query');
        return {
            tokenCount: response.usage.total_tokens,
            vector: response.data[0]?.embedding || []
        };
    }

    public async embedDocument(text: string, _title?: string, _priority?: EmbeddingPriority): Promise<{ tokenCount: number; vectors: number[][] }> {
        const response = await this.requestEmbeddings([text], 'document');
        return {
            tokenCount: response.usage.total_tokens,
            vectors: response.data.map(d => d.embedding)
        };
    }

    public async embedChunks(texts: string[], _title?: string, _priority?: EmbeddingPriority): Promise<{ tokenCount: number; vectors: number[][] }> {
        const batches = this.createBatches(texts);
        let totalTokens = 0;
        const allVectors: number[][] = [];

        for (const batch of batches) {
            const response = await this.requestEmbeddings(batch, 'document');
            totalTokens += response.usage.total_tokens;
            
            const sortedBatch = response.data.sort((a, b) => a.index - b.index);
            allVectors.push(...sortedBatch.map(d => d.embedding));
        }

        return { tokenCount: totalTokens, vectors: allVectors };
    }

    private createBatches(texts: string[]): string[][] {
        const modelLimit = VOYAGE_TOKEN_LIMITS[this.settings.embeddingModel] || DEFAULT_LIMIT;
        const safeLimit = modelLimit * 0.9;
        const maxBatchSize = 1000;

        const batches: string[][] = [];
        let currentBatch: string[] = [];
        let currentBatchTokens = 0;

        for (const text of texts) {
            const estimatedTokens = Math.ceil(text.length / SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE);
            
            if (currentBatch.length >= maxBatchSize || (currentBatchTokens + estimatedTokens > safeLimit)) {
                if (currentBatch.length > 0) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentBatchTokens = 0;
                }
            }

            currentBatch.push(text);
            currentBatchTokens += estimatedTokens;
        }

        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    private async requestEmbeddings(input: string[], inputType: 'query' | 'document'): Promise<VoyageResponse> {
        return this.retryOperation(async () => {
            const apiKey = await this.getApiKey();
            if (!apiKey) {
                if (getVoyageApiKeySecretName(this.settings)) {
                    new Notice("Voyage API key not found in this device's keychain. Please re-select it in settings.");
                }
                throw new ProviderError("Voyage API Key is missing or could not be retrieved.", "voyage");
            }

            const model = this.settings.embeddingModel.replace('voyage/', '');
            
            const response = await requestUrl({
                body: JSON.stringify({
                    input,
                    input_type: inputType,
                    model,
                    output_dimension: (this.settings.embeddingDimension && this.settings.embeddingDimension !== 1024) ? this.settings.embeddingDimension : undefined
                }),
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                method: 'POST',
                url: 'https://api.voyageai.com/v1/embeddings'
            });

            if (response.status !== 200) {
                const errorData = response.json as { error?: { message?: string } } | undefined;
                const message = errorData?.error?.message || response.text || `Voyage API error ${response.status}`;
                
                const retryAfter = response.headers['retry-after'];
                const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
                
                throw new ProviderError(message, "voyage", response.status, retryAfterSec);
            }

            return response.json as VoyageResponse;
        });
    }

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.settings.voyageRetries): Promise<T> {
        let lastError: Error | null = null;
        let delay = RETRY_CONSTANTS.INITIAL_DELAY_MS;
        const MAX_BACKOFF_MS = RETRY_CONSTANTS.MAX_BACKOFF_MS;

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error: unknown) {
                const err = error as { message?: string; status?: number; retryAfter?: number };
                
                // Obsidian's requestUrl often throws an error with the status in the message.
                // We must check both the status property and the message string.
                const isTransientError = 
                    err.status === 429 || 
                    err.message?.includes("429") || 
                    err.status === 503 || 
                    err.status === 504 || 
                    err.message?.includes("Failed to fetch");

                if (isTransientError) {
                    // Use server-provided retry-after if available, otherwise use our backoff
                    const retryAfterMs = err.retryAfter ? err.retryAfter * 1000 : delay;
                    
                    // Add jitter (±10%) to prevent thundering herd if multiple chunks fail
                    const jitter = 0.9 + Math.random() * 0.2;
                    const finalDelay = Math.min(retryAfterMs * jitter, MAX_BACKOFF_MS);

                    logger.warn(`Voyage transient error (${err.message || "unknown"}). Retrying in ${Math.round(finalDelay)}ms...`);
                    
                    lastError = error instanceof Error ? error : new Error(String(error));
                    await new Promise(resolve => window.setTimeout(resolve, finalDelay));
                    
                    // Only increase our internal delay if the server didn't specify a time
                    if (!err.retryAfter) {
                        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
                    }
                } else {
                    throw error;
                }
            }
        }
        throw lastError || new ProviderError("Max retries reached.", "voyage", 429);
    }
}
