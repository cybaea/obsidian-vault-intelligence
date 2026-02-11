import * as Comlink from 'comlink';
import { App, requestUrl } from "obsidian";

import { WorkerAPI, WorkerConfig } from "../types/graph";
import { logger } from "../utils/logger";
import IndexerWorkerModule from "../workers/indexer.worker";
import { IEmbeddingService } from "./IEmbeddingService";

/**
 * Manages the lifecycle and communication with the Indexer Web Worker.
 * Handles Comlink wrapping and proxying of main-thread services to the worker.
 */
export class WorkerManager {
    private app: App;
    private embeddingService: IEmbeddingService;
    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;

    constructor(app: App, embeddingService: IEmbeddingService) {
        this.app = app;
        this.embeddingService = embeddingService;
    }

    /**
     * Spawns a new worker and initializes the Comlink API.
     */
    public async spawn(): Promise<Comlink.Remote<WorkerAPI>> {
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
     * Initializes the worker with the provided configuration and proxies.
     */
    public async initializeWorker(config: WorkerConfig): Promise<boolean> {
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
            const vectors = await this.embeddingService.embedDocument(text, title);
            return vectors[0];
        });

        return await api.initialize(config, fetcher, embedder);
    }

    /**
     * Terminates the worker and cleans up resources.
     */
    public terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.api = null;
        }
    }

    /**
     * Provides access to the remote Worker API.
     */
    public getApi(): Comlink.Remote<WorkerAPI> | null {
        return this.api;
    }
}
