import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";
import { Plugin, Notice } from "obsidian";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

import EmbeddingWorker from "../workers/embedding.worker";

interface WorkerMessage {
    id: number;
    status: 'success' | 'error';
    output?: number[][];
    error?: string;
}


export class LocalEmbeddingService implements IEmbeddingService {
    private plugin: Plugin;
    private settings: VaultIntelligenceSettings;
    private worker: Worker | null = null;

    private messageId = 0;
    private pendingRequests = new Map<number, { resolve: (val: number[][]) => void, reject: (err: unknown) => void }>();
    private requestQueue: { id: number, text: string, priority: EmbeddingPriority, resolve: (val: number[][]) => void, reject: (err: unknown) => void }[] = [];
    private isWorkerBusy = false;

    constructor(plugin: Plugin, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.settings = settings;
    }

    /**
     * Force a re-download of the model by clearing the cache and restarting the worker.
     */
    public async forceRedownload() {
        // 1. Terminate the current worker to release any file locks/memory
        this.terminate();

        // 2. Clear the Cache Storage (Shared between Main thread and Worker)
        // Transformers.js stores models in caches starting with "transformers-cache"
        const cacheKeys = await window.caches.keys();
        for (const key of cacheKeys) {
            if (key.startsWith('transformers-cache')) {
                await window.caches.delete(key);
                logger.info(`[LocalEmbedding] Deleted cache: ${key}`);
            }
        }

        // 3. Re-initialize the worker
        // This creates a fresh worker instance
        await this.initialize();

        // 4. Trigger a "warm-up" runs to force the download immediately
        // The worker will see the cache is empty and fetch from CDN
        new Notice("Cache cleared. Starting download...");

        try {
            // We run a dummy embedding to trigger the pipeline loading
            await this.runTask("warmup");
            new Notice("Model downloaded and ready!");
        } catch (e) {
            new Notice("Error downloading model. Check internet connection.");
            logger.error("Redownload failed", e);
        }
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    public async initialize() {
        if (this.worker) return;

        await Promise.resolve();

        try {
            // MAGIC LINE: Just instantiate it like a class
            const instance = new EmbeddingWorker({ name: 'VaultIntelligenceWorker' });
            this.worker = instance;

            instance.onmessage = (e: MessageEvent) => this._onMessage(e);
            instance.onerror = (e: ErrorEvent) => {
                logger.error("[LocalEmbedding] Worker Error:", e);
                new Notice("Local worker crashed.");
            };

            logger.info("Local embedding worker initialized (Inline).");
        } catch (e) {
            logger.error("Failed to spawn worker:", e);
            new Notice("Failed to load local worker.");
        }
    }

    private _onMessage(event: MessageEvent) {
        const data = event.data as unknown as WorkerMessage;
        const { id, status, output, error } = data;

        const promise = this.pendingRequests.get(id);
        if (promise) {
            if (status === 'success' && output) {
                promise.resolve(output);
            } else {
                promise.reject(error || "Unknown worker error");
            }
            this.pendingRequests.delete(id);
        }

        // Process next task in queue
        this.isWorkerBusy = false;
        void this.processQueue();
    }

    private async processQueue() {
        if (this.isWorkerBusy || this.requestQueue.length === 0) return;

        // Ensure worker is initialized
        if (!this.worker) await this.initialize();
        if (!this.worker) return;

        this.isWorkerBusy = true;

        // Find highest priority task
        const highPriorityIdx = this.requestQueue.findIndex(r => r.priority === 'high');
        const taskIdx = highPriorityIdx !== -1 ? highPriorityIdx : 0;
        const task = this.requestQueue.splice(taskIdx, 1)[0]!;

        this.pendingRequests.set(task.id, {
            resolve: task.resolve,
            reject: task.reject
        });

        this.worker.postMessage({
            id: task.id,
            type: 'embed',
            text: task.text,
            model: this.settings.embeddingModel
        });
    }

    private async runTask(text: string, priority: EmbeddingPriority = 'high'): Promise<number[][]> {
        const startTime = Date.now();

        return new Promise<number[][]>((resolve, reject) => {
            const id = this.messageId++;

            const wrappedResolve = (val: number[][]) => {
                logger.debug(`[LocalEmbedding] Task ${id} (${priority}) took ${Date.now() - startTime}ms`);
                resolve(val);
            };

            this.requestQueue.push({
                id,
                text,
                priority,
                resolve: wrappedResolve,
                reject
            });

            void this.processQueue();
        });
    }

    async embedQuery(text: string, priority: EmbeddingPriority = 'high'): Promise<number[]> {
        const vectors = await this.runTask(text, priority);
        // Queries should be single chunk. If multiple, take first? 
        // Or average? taking first is safer for now.
        return vectors[0] || [];
    }

    async embedDocument(text: string, title?: string, priority: EmbeddingPriority = 'high'): Promise<number[][]> {
        const content = title ? `Title: ${title}\n\n${text}` : text;
        return this.runTask(content, priority);
    }

    public terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}