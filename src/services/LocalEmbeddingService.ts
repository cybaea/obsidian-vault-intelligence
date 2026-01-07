import { IEmbeddingService } from "./IEmbeddingService";
import { Plugin, Notice } from "obsidian";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

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
    // FIX 1: Use 'unknown' for rejection type instead of 'any'
    private pendingRequests = new Map<number, { resolve: (val: number[]) => void, reject: (err: unknown) => void }>();

    constructor(plugin: Plugin, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.settings = settings;
    }

    get modelName(): string {
        return "local-all-minilm-l6-v2";
    }

    get dimensions(): number {
        return 384; 
    }

    public async initialize() {
        if (this.worker) return;

        // FIX 2: Satisfy 'require-await' rule. 
        // This is useful anyway if we later move to a loading strategy that is async.
        await Promise.resolve();

        const workerPath = this.plugin.manifest.dir + "/worker.js";
        
        try {
            const url = this.plugin.app.vault.adapter.getResourcePath(workerPath);
            
            this.worker = new Worker(url);

            this.worker.onmessage = (e) => this._onMessage(e);
            this.worker.onerror = (e) => {
                // FIX 3: Use logger instead of console
                logger.error("[LocalEmbedding] Worker Error:", e);
                // FIX 4: Sentence case for UI text
                new Notice("Local worker crashed.");
            };
            
            logger.info("Local embedding worker initialized.");
        } catch (e) {
            logger.error("Failed to spawn worker:", e);
            // FIX 4: Sentence case
            new Notice("Failed to load local worker.");
        }
    }

    private _onMessage(event: MessageEvent) {
        // FIX 5: cast to unknown first, then to our interface
        const data = event.data as unknown as WorkerMessage;
        const { id, status, output, error } = data;
        
        const promise = this.pendingRequests.get(id);

        if (promise) {
            // FIX 6: Ensure output exists before resolving
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
                text
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
