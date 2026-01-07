import { IEmbeddingService } from "./IEmbeddingService";
import { Plugin, Notice } from "obsidian";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

// FIX: Use @ts-expect-error because the source file has no export (to run in browser),
// but the build plugin generates a default export (the Worker constructor).
// @ts-expect-error: Build plugin auto-generates default export for workers.
import EmbeddingWorker from "../workers/embedding.worker";

interface WorkerMessage {
    id: number;
    status: 'success' | 'error';
    output?: number[];
    error?: string;
}

// Define the constructor type matching the worker module
type EmbeddingWorkerConstructor = new (options?: WorkerOptions) => Worker;

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
            const WorkerClass = EmbeddingWorker as unknown as EmbeddingWorkerConstructor;
            this.worker = new WorkerClass({ name: 'VaultIntelligenceWorker' });

            this.worker.onmessage = (e) => this._onMessage(e);
            this.worker.onerror = (e) => {
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