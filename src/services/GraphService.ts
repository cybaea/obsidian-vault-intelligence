import { Plugin, Notice, TFile } from "obsidian";
import * as Comlink from 'comlink';
import { VaultManager } from "./VaultManager";
import { GeminiService } from "./GeminiService";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";
import { WorkerAPI, WorkerConfig, GraphSearchResult, GraphNodeData } from "../types/graph";
import { IEmbeddingService } from "./IEmbeddingService";
import { OntologyService } from "./OntologyService";
import { GRAPH_CONSTANTS } from "../constants";

export interface GraphState {
    graph?: {
        nodes?: Array<{ id: string; attributes?: GraphNodeData }>;
    };
}

// @ts-expect-error - Inline worker import is handled by esbuild plugin
import IndexerWorkerModule from "../workers/indexer.worker";
const IndexerWorker = IndexerWorkerModule as unknown as { new(): Worker };

// Interface augmentation to support dynamic service access
interface PluginWithOntology extends Plugin {
    ontologyService?: OntologyService;
}

export class GraphService {
    private plugin: Plugin;
    private vaultManager: VaultManager;
    private gemini: GeminiService;
    private embeddingService: IEmbeddingService;
    private settings: VaultIntelligenceSettings;

    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;
    private isInitialized = false;

    // Serial queue to handle API rate limiting across all indexing tasks
    private processingQueue: Promise<unknown> = Promise.resolve();

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
                minSimilarityScore: this.settings.minSimilarityScore ?? 0.5,
                ontologyPath: this.settings.ontologyPath
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

            // 3. Ensure gitignore exists for data folder
            await this.ensureGitignore();

            // 4. Load existing state if any
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
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                const content = await this.vaultManager.readFile(file);
                const { mtime, size, basename } = this.vaultManager.getFileStat(file);
                await this.api.updateFile(file.path, content, mtime, size, basename);
                this.requestSave();
            });
        });

        this.vaultManager.onDelete((path) => {
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                await this.api.deleteFile(path);
                this.requestSave();
            });
        });

        this.vaultManager.onRename((oldPath, newPath) => {
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                await this.api.renameFile(oldPath, newPath);
                this.requestSave();
            });
        });
    }

    /**
     * Enqueues a task for the indexer worker, ensuring serial execution and rate limiting.
     */
    private async enqueueIndexingTask<T>(task: () => Promise<T>): Promise<T> {
        const result = this.processingQueue.then(async () => {
            const val = await task();
            const delay = this.settings.queueDelayMs || 100;
            await new Promise(resolve => setTimeout(resolve, delay));
            return val;
        });

        // Update the queue but ensure failures don't block the next task
        this.processingQueue = result.then(() => { }).catch((err) => {
            logger.error("[GraphService] Queue task failed:", err);
        });

        return result;
    }

    private saveTimeout: ReturnType<typeof setTimeout> | number | undefined = undefined;
    private requestSave() {
        if (this.saveTimeout) return;

        // Use requestIdleCallback if available, otherwise setTimeout
        const win = window as unknown as { requestIdleCallback?: (cb: (deadline: unknown) => void, options?: { timeout: number }) => number };
        const scheduler = win.requestIdleCallback?.bind(win) || ((cb: () => void) => setTimeout(cb, GRAPH_CONSTANTS.IDLE_SAVE_TIMEOUT_MS));

        this.saveTimeout = scheduler(() => {
            void (async () => {
                this.saveTimeout = undefined;
                await this.saveState();
            })();
        });
    }

    /**
     * Forces an immediate save of the graph state, clearing any pending debounce.
     * Useful for clean shutdowns.
     */
    public async forceSave() {
        if (this.saveTimeout !== undefined) {
            // Clear both standard timeout and RequestIdleCallback handle (treated as number in many envs)
            clearTimeout(this.saveTimeout as number);
            // If it was an idle callback, cancelIdleCallback might be needed but generic clearTimeout often safe enough or we just let it run.
            // For simplicity in this env, assuming clearTimeout covers strict setTimeout usage or we just race it.
            this.saveTimeout = undefined;
        }
        await this.saveState();
    }

    private async saveState() {
        if (!this.api) return;
        try {
            // Returns Uint8Array (MessagePack)
            const stateBuffer = await this.api.saveIndex();

            const dataPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`;

            // Write binary (ensure we only write the view's bytes, not the whole underlying buffer)
            const bufferToWrite = stateBuffer.byteLength === stateBuffer.buffer.byteLength
                ? stateBuffer.buffer
                : stateBuffer.buffer.slice(stateBuffer.byteOffset, stateBuffer.byteOffset + stateBuffer.byteLength);

            await this.plugin.app.vault.adapter.writeBinary(dataPath, bufferToWrite as ArrayBuffer);
            logger.debug("[GraphService] State persisted (MessagePack).");

            // Cleanup legacy JSON if it exists
            const legacyPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`;
            if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
                await this.plugin.app.vault.adapter.remove(legacyPath);
                logger.debug("[GraphService] Legacy JSON state removed.");
            }

        } catch (error) {
            logger.error("[GraphService] Save failed:", error);
        }
    }

    private async loadState() {
        if (!this.api) return;

        const dataPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`;
        const legacyPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`;

        // 1. Try loading MessagePack (Preferred)
        if (await this.plugin.app.vault.adapter.exists(dataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(dataPath);
                // Transfer buffer to worker
                await this.api.loadIndex(new Uint8Array(stateBuffer));
                logger.info("[GraphService] State loaded (MessagePack).");
                return;
            } catch (error) {
                logger.error("[GraphService] Load failed (MessagePack):", error);
            }
        }

        // 2. Fallback to Legacy JSON (Migration)
        if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(legacyPath);
                await this.api.loadIndex(stateJson);
                logger.info("[GraphService] State loaded (Legacy JSON).");
            } catch (error) {
                logger.error("[GraphService] Load failed (Legacy JSON):", error);
            }
        }
    }

    /**
     * Ensures a .gitignore file exists in the data directory to ignore generated files.
     */
    private async ensureGitignore() {
        const ignorePath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/.gitignore`;
        const exists = await this.plugin.app.vault.adapter.exists(ignorePath);

        if (!exists) {
            // Ignore everything in data/ except the .gitignore itself
            const content = "# Ignore everything\n*\n!.gitignore\n";
            try {
                // Ensure data folder exists first
                const dataFolder = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}`;
                if (!(await this.plugin.app.vault.adapter.exists(dataFolder))) {
                    await this.plugin.app.vault.createFolder(dataFolder);
                }

                await this.plugin.app.vault.adapter.write(ignorePath, content);
                logger.debug("[GraphService] Created .gitignore in data folder.");
            } catch (error) {
                logger.warn("[GraphService] Failed to create data/.gitignore:", error);
            }
        }
    }

    /**
     * Semantically searches the vault using vector embeddings.
     * @param query - The search query string.
     * @param limit - Max number of results (default determined by worker).
     * @returns A promise resolving to an array of search results.
     */
    public async search(query: string, limit?: number): Promise<GraphSearchResult[]> {
        if (!this.api) return [];
        const results = await this.api.search(query, limit);
        return results;
    }

    /**
     * Performs a keyword search on the Orama index.
     * @param query - The search query string.
     * @param limit - Max number of results.
     * @returns A promise resolving to an array of search results.
     */
    public async keywordSearch(query: string, limit?: number): Promise<GraphSearchResult[]> {
        if (!this.api) return [];
        const results = await this.api.keywordSearch(query, limit);
        return results;
    }

    /**
     * Semantically searches the vault within specific file paths.
     * @param query - The search query string.
     * @param paths - Array of file paths to restrict search to.
     * @param limit - Max number of results.
     * @returns A promise resolving to an array of search results.
     */
    public async searchInPaths(query: string, paths: string[], limit?: number): Promise<GraphSearchResult[]> {
        if (!this.api) return [];
        const results = await this.api.searchInPaths(query, paths, limit);
        return results;
    }

    public async getSimilar(path: string, limit?: number): Promise<GraphSearchResult[]> {
        if (!this.api) return [];

        // Ensure the source file is indexed before looking for similar files
        // This is important during initial scans or if the file was just created
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const content = await this.vaultManager.readFile(file);
            const { mtime, size, basename } = this.vaultManager.getFileStat(file);
            if (this.api) {
                await this.api.updateFile(path, content, mtime, size, basename);
            }
        }

        if (!this.api) return [];
        return await this.api.getSimilar(path, limit);
    }

    /**
     * Gets direct neighbors of a file in the graph.
     * @param path - The path of the source file.
     * @param options - Traversal options (direction, mode).
     * @returns A promise resolving to an array of neighboring files.
     */
    public async getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<GraphSearchResult[]> {
        if (!this.api) return [];
        const neighbors = await this.api.getNeighbors(path, options);
        return neighbors;
    }

    /**
     * Pushes the latest alias map from OntologyService to the Worker.
     * This ensures the graph worker knows how to canonicalize [[Alias]] links.
     */
    public async syncAliases() {
        if (!this.api) return;

        const plugin = this.plugin as unknown as PluginWithOntology;
        const ontologyService = plugin.ontologyService;

        if (ontologyService && typeof ontologyService.getValidTopics === 'function') {
            const topics = await ontologyService.getValidTopics();
            const map: Record<string, string> = {};

            for (const t of topics) {
                // Map the topic name/alias to its canonical path
                // "Project FooBar" -> "Ontology/Project FooBar.md"
                map[t.name] = t.path;
            }

            await this.api.updateAliasMap(map);
            logger.debug(`[GraphService] Synced ${topics.length} aliases to worker.`);
        }
    }

    /**
     * Gets structural importance metrics for a node.
     * @param path - The path of the source file.
     * @returns A promise resolving to an object containing node metrics.
     */
    public async getCentrality(path: string): Promise<number> {
        if (!this.api) return 0;
        const centrality = await this.api.getCentrality(path);
        return centrality;
    }

    /**
     * Gets structural importance metrics for a node.
     * @param path - The path of the source file.
     * @returns A promise resolving to an object containing node metrics.
     */
    public async getNodeMetadata(path: string): Promise<{ title?: string; headers?: string[] }> {
        if (!this.api) return {};
        const results = await this.api.getBatchMetadata([path]);
        return results[path] || {};
    }

    /**
     * Gets metadata for multiple nodes in a single worker call.
     * @param paths - Array of file paths.
     * @returns A promise resolving to a record of path -> metadata.
     */
    public async getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string; headers?: string[] }>> {
        if (!this.api) return {};
        const results = await this.api.getBatchMetadata(paths);
        return results;
    }

    /**
     * Fetches degree centrality for multiple nodes in a single worker call.
     * @param paths - Array of file paths.
     * @returns A promise resolving to a record of path -> centrality.
     */
    public async getBatchCentrality(paths: string[]): Promise<Record<string, number>> {
        if (!this.api) return {};
        const results = await this.api.getBatchCentrality(paths);
        return results;
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

        // Ensure aliases are up to date before scanning content
        await this.syncAliases();

        const files = this.vaultManager.getMarkdownFiles();
        const states = await this.api.getFileStates();

        logger.info(`[GraphService] Comparing ${files.length} files against index.`);
        if (forceWipe) {
            new Notice(`GraphService: scanning ${files.length} files`);
        }

        let count = 0;
        let skipCount = 0;

        for (const file of files) {
            const state = states[file.path];
            const { mtime, size, basename } = this.vaultManager.getFileStat(file);

            // OPTIMIZATION: Skip if mtime matches and we aren't forcing a wipe
            if (!forceWipe && state && state.mtime === mtime) {
                skipCount++;
                continue;
            }

            // Use the same enqueue mechanism so that multiple scanAll or interleaved onModify calls 
            // all respect the same serial throttle.
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                try {
                    const content = await this.vaultManager.readFile(file);
                    await this.api.updateFile(file.path, content, mtime, size, basename);
                    count++;

                    if (count % 50 === 0) {
                        logger.debug(`[GraphService] Processed ${count} files...`);
                    }
                } catch (error) {
                    logger.error(`[GraphService] Failed to index ${file.path}`, error);
                    if (String(error).includes("API key")) throw error;
                }
            });
        }

        if (skipCount > 0) {
            logger.info(`[GraphService] Skipped ${skipCount} unchanged files.`);
        }

        // Wait for the entire queue to flush before saving/marking done
        await this.processingQueue;

        await this.saveState();
        if (count > 0) {
            logger.info(`[GraphService] Scan complete. Total indexed: ${count}`);
            if (forceWipe) new Notice("GraphService: scan complete");
        }
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
                minSimilarityScore: settings.minSimilarityScore,
                ontologyPath: settings.ontologyPath
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
