import * as Comlink from 'comlink';
import { App, requestUrl } from "obsidian";

import { WorkerAPI, WorkerConfig } from "../types/graph";
import { IEmbeddingClient } from "../types/providers";
import { logger } from "../utils/logger";
import IndexerWorkerModule from "../workers/indexer.worker";

/**
 * Manages the lifecycle and communication with the Indexer Web Worker.
 * Handles Comlink wrapping and proxying of main-thread services to the worker.
 * Provides separate execution paths for mutations (serial) and queries (concurrent).
 */
export class WorkerManager {
    private app: App;
    private embeddingService: IEmbeddingClient;
    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;

    // Session State
    private activeModelId: string | null = null;
    private activeDimension: number | null = null;
    private workerSessionId = 0;

    // Serial queue for mutations to handle API rate limiting and race conditions
    private mutationQueue: Promise<unknown> = Promise.resolve();

    constructor(app: App, embeddingService: IEmbeddingClient) {
        this.app = app;
        this.embeddingService = embeddingService;
    }

    /**
     * Initializes the worker with the provided configuration and proxies.
     * Freezes the session state for this worker epoch.
     */
    public async initializeWorker(config: WorkerConfig): Promise<boolean> {
        // FREEZE STATE FOR THIS WORKER EPOCH
        this.activeModelId = config.embeddingModel;
        this.activeDimension = config.embeddingDimension;
        this.workerSessionId++;

        const api = await this.spawn();

        const fetcher = Comlink.proxy(async (url: string, options: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const res = await requestUrl({
                body: options.body,
                headers: options.headers,
                method: options.method || 'GET',
                url
            });
            return res.json as unknown;
        });
        const embedder = Comlink.proxy(async (textOrTexts: string | string[], title: string) => {
            try {
                const timeoutMs = 300000; // 5 minutes per operation

                if (Array.isArray(textOrTexts)) {
                    logger.debug(`[WorkerManager] Embedding batch of ${textOrTexts.length} for ${title}`);
                    if (this.embeddingService.embedChunks) {
                        const batchTimeoutPromise = new Promise<never>((_, reject) => 
                            activeWindow.setTimeout(() => reject(new Error(`Embedding batch request timed out for ${title}`)), timeoutMs * 5)
                        );
                        return await Promise.race([
                            this.embeddingService.embedChunks(textOrTexts, title),
                            batchTimeoutPromise
                        ]);
                    }
                    const vectors: number[][] = [];
                    let totalTokens = 0;
                    for (const t of textOrTexts) {
                        const chunkTimeoutPromise = new Promise<never>((_, reject) => 
                            activeWindow.setTimeout(() => reject(new Error(`Embedding request timed out for chunk of ${title}`)), timeoutMs)
                        );
                        
                        const res = await Promise.race([
                            this.embeddingService.embedDocument(t, title),
                            chunkTimeoutPromise
                        ]);
                        
                        const vector = res.vectors[0];
                        if (!vector || vector.length === 0) {
                            logger.warn(`[WorkerManager] Skipping embedding for chunk of ${title} due to missing embedding.`);
                            continue;
                        }
                        vectors.push(vector);
                        totalTokens += res.tokenCount;
                    }
                    logger.debug(`[WorkerManager] Batch completed for ${title}. Vectors: ${vectors.length}, Tokens: ${totalTokens}`);
                    return { tokenCount: totalTokens, vectors };
                }

                if (title === 'Query') {
                    return await this.embeddingService.embedQuery(textOrTexts);
                }

                // Default: Embed as document (for indexing)
                const timeoutPromise = new Promise<never>((_, reject) => 
                    activeWindow.setTimeout(() => reject(new Error(`Embedding request timed out for ${title}`)), timeoutMs)
                );

                logger.debug(`[WorkerManager] Embedding single document: ${title} (${textOrTexts.length} chars)`);
                const { tokenCount, vectors } = await Promise.race([
                    this.embeddingService.embedDocument(textOrTexts, title),
                    timeoutPromise
                ]);
                
                const vector = vectors[0] || [];
                if (vector.length > 0) {
                    logger.debug(`[WorkerManager] Embedding successful for ${title}. Vector[0-4]: ${vector.slice(0, 5).join(', ')}`);
                } else {
                    logger.warn(`[WorkerManager] Embedding returned empty vector for ${title}`);
                }
                return { tokenCount, vector, vectors };
            } catch (error) {
                logger.error("[WorkerManager] Embedding proxy error:", error);
                throw error;
            }
        });

        return await api.initialize(config, fetcher, embedder);
    }

    /**
     * Spawns a new worker and initializes the Comlink API.
     */
    private async spawn(): Promise<Comlink.Remote<WorkerAPI>> {
        await Promise.resolve();
        if (this.api) return this.api;

        try {
            this.worker = new IndexerWorkerModule();
            this.api = Comlink.wrap<WorkerAPI>(this.worker);
            return this.api;
        } catch (error) {
            logger.error("[WorkerManager] Failed to spawn worker:", error);
            throw error;
        }
    }

    /**
     * Executes a mutation task in the worker.
     * Mutations are strictly serialized, respect queue delays, and are dropped if the worker restarts.
     */
    public async executeMutation<T>(task: (api: Comlink.Remote<WorkerAPI>) => Promise<T>, delayMs = 100): Promise<T> {
        const capturedSessionId = this.workerSessionId;

        // Serialise execution by appending to the queue tail
        const taskInQueue = (async () => {
            // Always wait for the previous promise in the queue to settle (success or fail)
            await this.mutationQueue.catch(() => {});

            if (!this.api || this.workerSessionId !== capturedSessionId) {
                logger.debug(`[WorkerManager] Dropping zombie mutation (Session ${capturedSessionId} vs ${this.workerSessionId})`);
                throw new Error("TaskDropped: Worker session changed");
            }

            const result = await task(this.api);
            if (delayMs > 0) {
                await new Promise(resolve => activeWindow.setTimeout(resolve, delayMs));
            }
            return result;
        })();

        // Update the queue tail to be this new task. 
        // We catch here so that a failure in this task doesn't cause the next task to automatically reject.
        this.mutationQueue = taskInQueue.catch((err) => {
            if (err instanceof Error && err.message.includes("TaskDropped")) return;
            logger.error("[WorkerManager] Mutation task failed:", err);
        });

        return taskInQueue;
    }

    /**
     * Executes a query task in the worker.
     * Queries are concurrent and bypass the mutation queue for immediate UI updates.
     */
    public async executeQuery<T>(task: (api: Comlink.Remote<WorkerAPI>) => Promise<T>): Promise<T> {
        if (!this.api) throw new Error("Worker API not initialized");
        // Queries do not need zombie guards as they are immediate and idempotent
        return await task(this.api);
    }

    /**
     * Terminates the worker and cleans up resources.
     */
    public terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.api = null;
            this.activeModelId = null;
            this.activeDimension = null;
            this.mutationQueue = Promise.resolve(); // Reset queue
        }
    }

    /**
     * Provides access to the remote Worker API.
     */
    public getApi(): Comlink.Remote<WorkerAPI> | null {
        return this.api;
    }

    /**
     * Waits for all currently queued mutations to complete.
     */
    public async waitForIdle(): Promise<void> {
        await this.mutationQueue;
    }

    public get activeModel(): { id: string | null; dimension: number | null; sessionId: number } {
        return {
            dimension: this.activeDimension,
            id: this.activeModelId,
            sessionId: this.workerSessionId
        };
    }
}
