import { Plugin, Notice, TFile } from "obsidian";
import * as Comlink from 'comlink';
import { VaultManager } from "./VaultManager";
import { GeminiService } from "./GeminiService";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";
import { WorkerAPI, WorkerConfig } from "../types/graph";

import { IEmbeddingService } from "./IEmbeddingService";

// @ts-ignore
import IndexerWorkerModule from "../workers/indexer.worker";
const IndexerWorker = IndexerWorkerModule as unknown as { new(): Worker };

const DATA_DIR = "data";
const GRAPH_FILE = "graph-state.json";

export class GraphService {
    private plugin: Plugin;
    private vaultManager: VaultManager;
    private gemini: GeminiService;
    private embeddingService: IEmbeddingService;
    private settings: VaultIntelligenceSettings;

    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;
    private isInitialized = false;

    constructor(plugin: Plugin, vaultManager: VaultManager, gemini: GeminiService, embeddingService: IEmbeddingService, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.vaultManager = vaultManager;
        this.gemini = gemini;
        this.embeddingService = embeddingService;
        this.settings = settings;
    }

    /**
     * Initializes the Graph Service and spawns the Indexer Worker.
     * This method is idempotent and will return immediately if already initialized.
     */
    public async initialize() {
        if (this.isInitialized) return;

        try {
            // 1. Spawn worker
            this.worker = new IndexerWorker();
            this.api = Comlink.wrap<WorkerAPI>(this.worker);

            // 2. Configure worker
            const config: WorkerConfig = {
                googleApiKey: this.settings.googleApiKey,
                embeddingModel: this.settings.embeddingModel,
                embeddingDimension: this.settings.embeddingDimension,
                chatModel: this.settings.chatModel,
                indexingDelayMs: this.settings.indexingDelayMs || 2000,
                minSimilarityScore: this.settings.minSimilarityScore ?? 0.5
            };

            const fetcher = Comlink.proxy(async (url: string, options: { method?: string; headers?: Record<string, string>; body?: string }) => {
                const { requestUrl } = await import("obsidian");
                const res = await requestUrl({
                    url,
                    method: options.method || 'GET',
                    headers: options.headers,
                    body: options.body
                });
                return res.json as unknown;
            });

            const embedder = Comlink.proxy(async (text: string, _title: string) => {
                return await this.embeddingService.embedQuery(text);
            });

            await this.api.initialize(config, fetcher, embedder);

            // 3. Load existing state if any
            await this.loadState();

            // 4. Register event listeners
            this.registerEvents();

            this.isInitialized = true;
            logger.info("[GraphService] Initialized and worker started.");
        } catch (error) {
            logger.error("[GraphService] Initialization failed:", error);
            new Notice("Failed to initialize vault intelligence graph");
        }
    }

    private registerEvents() {
        this.vaultManager.onModify((file) => {
            void (async () => {
                if (!this.api) return;
                const content = await this.vaultManager.readFile(file);
                const { mtime, size, basename } = this.vaultManager.getFileStat(file);
                await this.api.updateFile(file.path, content, mtime, size, basename);
                this.requestSave();
            })();
        });

        this.vaultManager.onDelete((path) => {
            void (async () => {
                if (!this.api) return;
                await this.api.deleteFile(path);
                this.requestSave();
            })();
        });

        this.vaultManager.onRename((oldPath, newPath) => {
            void (async () => {
                if (!this.api) return;
                await this.api.renameFile(oldPath, newPath);
                this.requestSave();
            })();
        });
    }

    private saveTimeout: ReturnType<typeof setTimeout> | number | undefined = undefined;
    private requestSave() {
        if (this.saveTimeout) return;

        // Use requestIdleCallback if available, otherwise setTimeout
        const win = window as unknown as { requestIdleCallback?: (cb: (deadline: unknown) => void, options?: { timeout: number }) => number };
        const scheduler = win.requestIdleCallback?.bind(win) || ((cb: () => void) => setTimeout(cb, 5000));

        this.saveTimeout = scheduler(() => {
            void (async () => {
                this.saveTimeout = undefined;
                await this.saveState();
            })();
        });
    }

    private async saveState() {
        if (!this.api) return;
        try {
            const state = await this.api.saveIndex();
            const dataPath = `${this.plugin.manifest.dir}/${DATA_DIR}/${GRAPH_FILE}`;
            await this.plugin.app.vault.adapter.write(dataPath, state);
            logger.debug("[GraphService] State persisted.");
        } catch (error) {
            logger.error("[GraphService] Save failed:", error);
        }
    }

    private async loadState() {
        if (!this.api) return;
        const dataPath = `${this.plugin.manifest.dir}/${DATA_DIR}/${GRAPH_FILE}`;
        if (await this.plugin.app.vault.adapter.exists(dataPath)) {
            try {
                const state = await this.plugin.app.vault.adapter.read(dataPath);
                await this.api.loadIndex(state);
                logger.info("[GraphService] State loaded.");
            } catch (error) {
                logger.error("[GraphService] Load failed:", error);
            }
        }
    }

    /**
     * Semantically searches the vault using vector embeddings.
     * @param query - The search query string.
     * @param limit - Max number of results (default determined by worker).
     * @returns A promise resolving to an array of search results.
     */
    public async search(query: string, limit?: number) {
        if (!this.api) return [];
        return await this.api.search(query, limit);
    }

    /**
     * Finds files similar to the given file path.
     * @param path - The path of the source file to find connections for.
     * @param limit - Max number of results.
     * @returns A promise resolving to an array of similar files.
     */
    public async getSimilar(path: string, limit?: number) {
        if (!this.api) return [];

        // Ensure the source file is indexed before looking for similar files
        // This is important during initial scans or if the file was just created
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const content = await this.vaultManager.readFile(file);
            const { mtime, size, basename } = this.vaultManager.getFileStat(file);
            await this.api.updateFile(path, content, mtime, size, basename);
        }

        return await this.api.getSimilar(path, limit);
    }

    /**
     * Scans all markdown files in the vault and queues them for indexing.
     * @param forceWipe - If true, clears the existing graph and Orama index before scanning.
     */
    public async scanAll(forceWipe = false) {
        if (!this.api) return;

        if (forceWipe) {
            logger.info("[GraphService] Force resetting Graph and Orama index before scan.");
            await this.api.fullReset();
        }

        const files = this.vaultManager.getMarkdownFiles();
        logger.info(`[GraphService] Starting scan of ${files.length} files`);
        new Notice(`GraphService: scanning ${files.length} files`);

        let count = 0;
        for (const file of files) {
            const content = await this.vaultManager.readFile(file);
            const { mtime, size, basename } = this.vaultManager.getFileStat(file);
            await this.api.updateFile(file.path, content, mtime, size, basename);
            count++;
            if (count % 50 === 0) {
                logger.debug(`[GraphService] Processed ${count}/${files.length} files`);
            }
        }

        await this.saveState();
        logger.info(`[GraphService] Scan complete. Total: ${count}`);
        new Notice("GraphService: initial scan complete");
    }

    /**
     * Updates the worker configuration with new settings.
     * @param settings - The new plugin settings.
     */
    public async updateConfig(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        if (this.api) {
            await this.api.updateConfig({
                googleApiKey: settings.googleApiKey,
                embeddingModel: settings.embeddingModel,
                embeddingDimension: settings.embeddingDimension,
                chatModel: settings.chatModel,
                indexingDelayMs: settings.indexingDelayMs,
                minSimilarityScore: settings.minSimilarityScore
            });
        }
    }

    /**
     * Terminates the worker and cleans up resources.
     */
    public shutdown() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.api = null;
        this.isInitialized = false;
    }
}
