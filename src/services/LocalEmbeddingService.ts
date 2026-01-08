import { IEmbeddingService } from "./IEmbeddingService";
import { Plugin, Notice } from "obsidian";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

import EmbeddingWorker from "../workers/embedding.worker";

interface WorkerMessage {
    id: number;
    status: 'success' | 'error';
    output?: number[];
    error?: string;
}


export class LocalEmbeddingService implements IEmbeddingService {
    private plugin: Plugin;
    private settings: VaultIntelligenceSettings;
    private worker: Worker | null = null;

    private messageId = 0;
    private pendingRequests = new Map<number, { resolve: (val: number[]) => void, reject: (err: unknown) => void }>();

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
    }

    private async runTask(text: string): Promise<number[]> {
        await this.initialize();
        if (!this.worker) throw new Error("Worker not active");

        return new Promise<number[]>((resolve, reject) => {
            const id = this.messageId++;
            this.pendingRequests.set(id, { resolve, reject });

            this.worker!.postMessage({
                id,
                type: 'embed',
                text,
                model: this.settings.embeddingModel
            });
        });
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.runTask(text);
    }

    async embedDocument(text: string, title?: string): Promise<number[]> {
        const content = title ? `Title: ${title}\n\n${text}` : text;
        return this.runTask(content);
    }

    public terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}