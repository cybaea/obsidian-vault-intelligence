import * as Comlink from 'comlink';
import { App, requestUrl } from "obsidian";

import { WorkerAPI, WorkerConfig } from "../types/graph";
import { logger } from "../utils/logger";
import IndexerWorkerModule from "../workers/indexer.worker";
import { IEmbeddingService } from "./IEmbeddingService";

/**
 * Manages the lifecycle and communication with the Indexer Web Worker.
 * Handles Comlink wrapping and proxying of main-thread services to the worker.
 * Provides separate execution paths for mutations (serial) and queries (concurrent).
 */
export class WorkerManager {
    private app: App;
    private embeddingService: IEmbeddingService;
    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;

    // Session State
    private activeModelId: string | null = null;
    private activeDimension: number | null = null;
    private workerSessionId = 0;

    // Serial queue for mutations to handle API rate limiting and race conditions
    private mutationQueue: Promise<unknown> = Promise.resolve();

    constructor(app: App, embeddingService: IEmbeddingService) {
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

        const embedder = Comlink.proxy(async (text: string, title: string) => {
            if (title === 'Query') {
                return await this.embeddingService.embedQuery(text);
            }
            // Default: Embed as document (for indexing)
            const { tokenCount, vectors } = await this.embeddingService.embedDocument(text, title);
            return { tokenCount, vector: vectors[0] || [] };
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

        const result = this.mutationQueue.then(async () => {
            if (!this.api || this.workerSessionId !== capturedSessionId) {
                logger.debug(`[WorkerManager] Dropping zombie mutation (Session ${capturedSessionId} vs ${this.workerSessionId})`);
                throw new Error("TaskDropped: Worker session changed");
            }

            const val = await task(this.api);
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            return val;
        });

        // Update the queue but ensure failures don't block the next task
        this.mutationQueue = result.then(() => { }).catch((err) => {
            if (err instanceof Error && err.message.includes("TaskDropped")) return;
            logger.error("[WorkerManager] Mutation task failed:", err);
        });

        return result;
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
            this.mutationQueue = Promise.resolve(); // Reset queue
        }
    }

    /**
     * Provides access to the remote Worker API.
     */
    public getApi(): Comlink.Remote<WorkerAPI> | null {
        return this.api;
    }

    public get activeModel(): { id: string | null; dimension: number | null; sessionId: number } {
        return {
            dimension: this.activeDimension,
            id: this.activeModelId,
            sessionId: this.workerSessionId
        };
    }
}
