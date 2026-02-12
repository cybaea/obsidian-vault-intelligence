import { Notice, requestUrl } from "obsidian";

import { WORKER_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings, IVaultIntelligencePlugin } from "../settings/types";
import { WorkerMessage, ProgressPayload, ConfigureMessage } from "../types/worker.types";
import { logger } from "../utils/logger";
import EmbeddingWorker from "../workers/embedding.worker";
import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";
import { ModelRegistry } from "./ModelRegistry";

interface EmbeddingTask {
    id: number;
    priority: EmbeddingPriority;
    reject: (err: unknown) => void;
    resolve: (val: { vectors: number[][], tokenCount: number }) => void;
    text: string;
    title?: string;
}

export class LocalEmbeddingService implements IEmbeddingService {
    private plugin: IVaultIntelligencePlugin;
    private settings: VaultIntelligenceSettings;
    private worker: Worker | null = null;
    private lastNotice: Notice | null = null;
    private lastNoticeTime = 0;

    private restartCount = 0;
    private lastRestartTime = 0;
    private isCircuitBroken = false;
    private fallbackThreads: number | null = null;
    private fallbackSimd: boolean | null = null;
    private lastInitTime = 0;

    private messageId = 0;
    private pendingRequests = new Map<number, { resolve: (val: { vectors: number[][], tokenCount: number }) => void, reject: (err: unknown) => void }>();
    private requestQueue: EmbeddingTask[] = [];
    private isWorkerBusy = false;

    constructor(plugin: IVaultIntelligencePlugin, settings: VaultIntelligenceSettings) {
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

        // Reset circuit breaker if it's been more than reset window since last crash
        if (this.isCircuitBroken && Date.now() - this.lastRestartTime > WORKER_CONSTANTS.CIRCUIT_BREAKER_RESET_MS) {
            this.isCircuitBroken = false;
            this.restartCount = 0;
        }

        if (this.isCircuitBroken) {
            logger.warn("[LocalEmbedding] Circuit broken. Refusing to start worker.");
            return;
        }

        await Promise.resolve();

        try {
            // MAGIC LINE: Just instantiate it like a class
            const instance = new EmbeddingWorker({ name: 'VaultIntelligenceWorker' });
            this.worker = instance;

            this.worker.onmessage = (e: MessageEvent) => this._onMessage(e);
            this.worker.onerror = (e: ErrorEvent) => {
                let errorDetails = 'No error object';
                if (e.error) {
                    if (e.error instanceof Error) {
                        errorDetails = e.error.stack || e.error.message;
                    } else {
                        errorDetails = String(e.error);
                    }
                }

                const errorInfo = {
                    colno: e.colno,
                    error: errorDetails,
                    filename: e.filename,
                    lineno: e.lineno,
                    message: e.message
                };

                logger.error("[LocalEmbedding] Worker Thread Crash:", errorInfo);

                // Circuit Breaker & Fallback Logic
                const now = Date.now();
                const isEarlyCrash = (now - this.lastInitTime < WORKER_CONSTANTS.BOOT_CRASH_THRESHOLD_MS);

                if (now - this.lastRestartTime < WORKER_CONSTANTS.CRASH_LOOP_WINDOW_MS) {
                    this.restartCount++;
                } else {
                    this.restartCount = 1;
                }
                this.lastRestartTime = now;

                // Escalate fallback faster if it's an early crash (likely boot/WASM/SIMD failure)
                if (isEarlyCrash) {
                    logger.warn("[LocalEmbedding] Worker crashed immediately after boot. Escalating stable modes.");
                }

                // Stage 1: 1 Thread
                if ((this.restartCount === 2 || (isEarlyCrash && this.restartCount === 1)) && (this.settings.embeddingThreads > 1 || this.fallbackThreads !== 1)) {
                    logger.warn("[LocalEmbedding] Stability Note: Your system may be incompatible with multi-threaded WASM. Enabling Single-Threaded mode for stability.");
                    this.fallbackThreads = 1;

                    // Persist this stable mode if it's an early crash (likely environment mismatch)
                    if (isEarlyCrash && this.settings.embeddingThreads > 1) {
                        this.settings.embeddingThreads = 1;
                        void this.plugin.saveSettings();
                    }
                }

                // Stage 2: No SIMD (Safe Mode)
                if ((this.restartCount === 3 || (isEarlyCrash && this.restartCount >= 2)) && (this.fallbackSimd !== false && this.settings.embeddingSimd !== false)) {
                    logger.warn("[LocalEmbedding] Stability Note: SIMD instructions failed. Enabling Safe Mode (No SIMD).");
                    this.fallbackSimd = false;

                    // Persist Safe Mode
                    this.settings.embeddingSimd = false;
                    void this.plugin.saveSettings();
                }

                if (this.restartCount > WORKER_CONSTANTS.MAX_CRASH_RETRY) {
                    this.isCircuitBroken = true;
                    const msg = "Local embedding worker crashed repeatedly. Automatic restart disabled to prevent loop. Please try 'Force Download' in settings or switch models.";
                    logger.error(`[LocalEmbedding] ${msg}`);
                    new Notice(msg, 10000);
                    this.terminate();
                    return;
                }

                new Notice(`Local embedding worker crashed (${this.restartCount}/3). Attempting to restart...`);

                // 1. Terminate the zombie worker
                this.terminate();

                // 2. Reject all pending requests to unblock the queue
                if (this.pendingRequests.size > 0) {
                    for (const [id, promise] of this.pendingRequests.entries()) {
                        promise.reject(`Worker crashed during processing: ${e.message || 'Unknown error'}`);
                        this.pendingRequests.delete(id);
                    }
                }

                // 3. Reset state
                this.isWorkerBusy = false;

                // 4. Trigger auto-restart
                void this.initialize();

                // 5. Try to keep processing queue if items remain
                void this.processQueue();
            };

            // Configure based on Platform & Settings
            const numThreads = this.fallbackThreads ?? this.settings.embeddingThreads;
            const simd = this.fallbackSimd ?? this.settings.embeddingSimd;

            this.lastInitTime = Date.now();
            instance.postMessage({
                cdnUrl: WORKER_CONSTANTS.WASM_CDN_URL,
                numThreads,
                simd,
                type: 'configure',
                version: WORKER_CONSTANTS.WASM_VERSION
            } as ConfigureMessage);

            logger.info(`Local embedding worker initialized (${numThreads} threads, SIMD: ${simd}${this.fallbackThreads ? ' [THREAD-FALLBACK]' : ''}${this.fallbackSimd === false ? ' [SIMD-FALLBACK]' : ''}).`);
        } catch (e) {
            logger.error("Failed to spawn worker:", e);
            new Notice("Failed to load local worker.");
        }
    }

    public updateConfiguration() {
        if (!this.worker) return;
        this.worker.postMessage({
            cdnUrl: WORKER_CONSTANTS.WASM_CDN_URL,
            numThreads: this.settings.embeddingThreads,
            simd: this.settings.embeddingSimd,
            type: 'configure',
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

        const { error, id, output, status } = data;

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
        const task = this.requestQueue.splice(taskIdx, 1)[0];
        if (!task) {
            this.isWorkerBusy = false;
            return;
        }

        this.pendingRequests.set(task.id, {
            reject: task.reject,
            resolve: task.resolve
        });

        const modelDef = ModelRegistry.getModelById(this.settings.embeddingModel);
        const titleInfo = task.title ? ` [${task.title}]` : '';

        logger.info(`[LocalEmbedding] Generating vector for document${titleInfo} (${task.text.length} chars).`);
        logger.debug(`[LocalEmbedding] Posting to worker: id=${task.id}, model=${this.settings.embeddingModel}, textLength=${task.text.length}`);
        this.worker.postMessage({
            id: task.id,
            model: this.settings.embeddingModel,
            quantized: modelDef?.quantized !== false, // Default to true unless explicitly false in registry
            text: task.text,
            type: 'embed'
        });
    }

    private async runTask(text: string, priority: EmbeddingPriority = 'high', title?: string): Promise<{ vectors: number[][], tokenCount: number }> {
        if (!text || text.trim().length === 0) {
            logger.debug(`[LocalEmbedding] Skipping empty text for: ${title || 'unknown'}`);
            return { tokenCount: 0, vectors: [] };
        }
        const startTime = Date.now();

        return new Promise<{ vectors: number[][], tokenCount: number }>((resolve, reject) => {
            const id = this.messageId++;

            const wrappedResolve = (val: { vectors: number[][], tokenCount: number }) => {
                logger.debug(`[LocalEmbedding] Task ${id} (${priority}) took ${Date.now() - startTime}ms`);
                resolve(val);
            };

            this.requestQueue.push({
                id,
                priority,
                reject,
                resolve: wrappedResolve,
                text,
                title
            });

            void this.processQueue();
        });
    }

    async embedQuery(text: string, priority: EmbeddingPriority = 'high'): Promise<{ vector: number[], tokenCount: number }> {
        const { tokenCount, vectors } = await this.runTask(text, priority);
        // Queries should be single chunk. If multiple, take first.
        return {
            tokenCount,
            vector: vectors[0] || []
        };
    }

    async embedDocument(text: string, title?: string, priority: EmbeddingPriority = 'high'): Promise<{ vectors: number[][], tokenCount: number }> {
        const content = title ? `Title: ${title}\n\n${text}` : text;

        // Main-thread chunking to prevent massive string transfers 
        // and ensure the worker yields/responds to heartbeats/IO periodically.
        const CHUNK_SIZE_CHARS = WORKER_CONSTANTS.MAX_CHARS_PER_TOKENIZATION_BLOCK;
        if (content.length <= CHUNK_SIZE_CHARS) {
            return this.runTask(content, priority, title);
        }

        logger.debug(`[LocalEmbedding] Chunking large document (${content.length} chars) into ${Math.ceil(content.length / CHUNK_SIZE_CHARS)} parts.`);
        const allVectors: number[][] = [];
        let totalTokens = 0;
        for (let i = 0; i < content.length; i += CHUNK_SIZE_CHARS) {
            const chunk = content.slice(i, i + CHUNK_SIZE_CHARS);
            const chunkTitle = title ? `${title} (Part ${i / CHUNK_SIZE_CHARS + 1})` : undefined;
            const { tokenCount, vectors } = await this.runTask(chunk, priority, chunkTitle);
            allVectors.push(...vectors);
            totalTokens += tokenCount;

            // Explicitly yield to main thread event loop between chunks
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return {
            tokenCount: totalTokens,
            vectors: allVectors
        };
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
                body: data.body,
                headers: headers,
                method: data.method || 'GET',
                throw: false, // Don't throw on 401, let the worker handle the status
                url: data.url,
            });

            if (response.status >= 400) {
                logger.debug(`[LocalEmbedding] Fetch failed (${response.status}): ${data.url}`);
            }

            this.worker.postMessage({
                body: response.arrayBuffer,
                headers: response.headers,
                requestId: data.requestId,
                status: response.status,
                type: 'fetch_response',
            }, [response.arrayBuffer]); // Use transferrable
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.worker.postMessage({
                error: message,
                requestId: data.requestId,
                type: 'fetch_response',
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