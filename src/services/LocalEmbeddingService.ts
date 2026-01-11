import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";
import { Plugin, Notice, Platform, requestUrl } from "obsidian";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";
import { WORKER_CONSTANTS } from "../constants";

import EmbeddingWorker from "../workers/embedding.worker";

interface WorkerMessage {
    id: number;
    status: 'success' | 'error';
    output?: number[][];
    error?: string;
    type?: string;
    // For fetch proxy
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    requestId?: number;
    // For progress reporting
    file?: string;
    progress?: number;
}

interface ProgressPayload {
    status: 'initiate' | 'downloading' | 'progress' | 'done' | 'ready';
    file?: string;
    progress?: number;
}

interface ConfigureMessage {
    type: 'configure';
    numThreads: number;
    simd: boolean;
    cdnUrl: string;
    version: string;
}

export class LocalEmbeddingService implements IEmbeddingService {
    private plugin: Plugin;
    private settings: VaultIntelligenceSettings;
    private worker: Worker | null = null;
    private lastNotice: Notice | null = null;
    private lastNoticeTime = 0;

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

            this.worker.onmessage = (e: MessageEvent) => this._onMessage(e);
            this.worker.onerror = (e: ErrorEvent) => {
                logger.error("[LocalEmbedding] Worker Error:", e);
                new Notice("Local worker crashed.");
            };

            // Configure based on Platform
            const numThreads = this.settings.embeddingThreads;
            const simd = !Platform.isMobile;
            // Actually Transformers.js usually handles SIMD detection, but we forced it on.
            // Let's stick to 1 thread for mobile.

            instance.postMessage({
                type: 'configure',
                numThreads,
                simd,
                cdnUrl: WORKER_CONSTANTS.WASM_CDN_URL,
                version: WORKER_CONSTANTS.WASM_VERSION
            } as ConfigureMessage);

            logger.info(`Local embedding worker initialized (${numThreads} threads, SIMD: ${simd}).`);
        } catch (e) {
            logger.error("Failed to spawn worker:", e);
            new Notice("Failed to load local worker.");
        }
    }

    public updateConfiguration() {
        if (!this.worker) return;
        this.worker.postMessage({
            type: 'configure',
            numThreads: this.settings.embeddingThreads,
            simd: !Platform.isMobile,
            cdnUrl: WORKER_CONSTANTS.WASM_CDN_URL,
            version: WORKER_CONSTANTS.WASM_VERSION
        } as ConfigureMessage);
    }

    private async _onMessage(event: MessageEvent) {
        const data = event.data as unknown as WorkerMessage;

        // Handle Fetch Proxy
        if (data.type === 'fetch') {
            await this.handleWorkerFetch(data);
            return;
        }

        // Handle Progress Reporting
        if (data.type === 'progress') {
            const payload = data as unknown as ProgressPayload;
            const now = Date.now();

            // Show notice every 2 seconds or on status change
            if (now - this.lastNoticeTime > 2000 || payload.status === 'done' || payload.status === 'initiate') {
                if (this.lastNotice) this.lastNotice.hide();

                let message = `[Intelligence] Loading model...`;
                if (payload.file) message = `[Intelligence] Downloading ${payload.file.split('/').pop() || payload.file}: ${Math.round(payload.progress || 0)}%`;
                if (payload.status === 'done') message = `[Intelligence] Model loaded!`;

                this.lastNotice = new Notice(message, payload.status === 'done' ? 5000 : 0);
                this.lastNoticeTime = now;
            }
            return;
        }

        const { id, status, output, error } = data;

        const promise = this.pendingRequests.get(id);
        if (promise) {
            if (status === 'success' && output) {
                promise.resolve(output);
            } else {
                const message = error || "Unknown worker error";
                logger.error(`[LocalEmbedding] Worker task ${id} failed:`, message);
                promise.reject(message);
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

        logger.debug(`[LocalEmbedding] Posting to worker: id=${task.id}, model=${this.settings.embeddingModel}, textLength=${task.text.length}`);
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

        // Main-thread chunking (10k chars) to prevent massive string transfers 
        // and ensure the worker yields/responds to heartbeats/IO periodically.
        const CHUNK_SIZE_CHARS = 10000;
        if (content.length <= CHUNK_SIZE_CHARS) {
            return this.runTask(content, priority);
        }

        logger.debug(`[LocalEmbedding] Chunking large document (${content.length} chars) into ${Math.ceil(content.length / CHUNK_SIZE_CHARS)} parts.`);
        const allVectors: number[][] = [];
        for (let i = 0; i < content.length; i += CHUNK_SIZE_CHARS) {
            const chunk = content.slice(i, i + CHUNK_SIZE_CHARS);
            const chunkVectors = await this.runTask(chunk, priority);
            allVectors.push(...chunkVectors);

            // Explicitly yield to main thread event loop between chunks
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return allVectors;
    }

    private async handleWorkerFetch(data: WorkerMessage) {
        if (!data.url || !this.worker) return;

        try {
            logger.debug(`[LocalEmbedding] Proxying fetch: ${data.url}`);

            // Robust header handling to prevent 401 leakage or auto-credential attachment
            const headers = { ...(data.headers || {}) };

            // Explicitly set User-Agent as some CDNs/HF require it or reject default ones
            if (!headers['User-Agent'] && !headers['user-agent']) {
                headers['User-Agent'] = 'Mozilla/5.0 (Obsidian Plugin; Vault Intelligence)';
            }

            const response = await requestUrl({
                url: data.url,
                method: data.method || 'GET',
                headers: headers,
                body: data.body,
                throw: false, // Don't throw on 401, let the worker handle the status
            });

            if (response.status >= 400) {
                logger.error(`[LocalEmbedding] Fetch failed (${response.status}): ${data.url}`);
            }

            this.worker.postMessage({
                type: 'fetch_response',
                requestId: data.requestId,
                status: response.status,
                headers: response.headers,
                body: response.arrayBuffer,
            }, [response.arrayBuffer]); // Use transferrable
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.worker.postMessage({
                type: 'fetch_response',
                requestId: data.requestId,
                error: message,
            });
        }
    }

    public terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}