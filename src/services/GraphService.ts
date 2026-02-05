import * as Comlink from 'comlink';
import { Plugin, Notice, TFile } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { WorkerAPI, WorkerConfig, GraphSearchResult, GraphNodeData } from "../types/graph";
import { logger } from "../utils/logger";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService } from "./IEmbeddingService";
import { OntologyService } from "./OntologyService";
import { VaultManager } from "./VaultManager";

export interface GraphState {
    graph?: {
        nodes?: Array<{ id: string; attributes?: GraphNodeData }>;
    };
}

import IndexerWorkerModule from "../workers/indexer.worker";
const IndexerWorker = IndexerWorkerModule;

// Interface augmentation to support dynamic service access
interface PluginWithOntology extends Plugin {
    ontologyService?: OntologyService;
}

/**
 * Service responsible for managing the semantic graph and vector index.
 * It spawns and communicates with the Indexer Worker to offload heavy computation
 * and ensures that the vault's semantic state is persisted.
 */
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
                authorName: this.settings.authorName,
                chatModel: this.settings.chatModel,
                contextAwareHeaderProperties: this.settings.contextAwareHeaderProperties,
                embeddingDimension: this.settings.embeddingDimension,
                embeddingModel: this.settings.embeddingModel,
                googleApiKey: this.settings.googleApiKey,
                indexingDelayMs: this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS,
                minSimilarityScore: this.settings.minSimilarityScore ?? 0.5,
                ontologyPath: this.settings.ontologyPath
            };

            const fetcher = Comlink.proxy(async (url: string, options: { method?: string; headers?: Record<string, string>; body?: string }) => {
                const { requestUrl } = await import("obsidian");
                const res = await requestUrl({
                    body: options.body,
                    headers: options.headers,
                    method: options.method || 'GET',
                    url
                });
                return res.json as unknown;
            });

            const embedder = Comlink.proxy(async (text: string, _title: string) => {
                return await this.embeddingService.embedQuery(text);
            });

            // Initialize worker
            await this.api.initialize(config, fetcher, embedder);

            // 3. Ensure gitignore exists for data folder
            await this.ensureGitignore();

            // 4. Load or Migrate
            await this.loadState();

            // 5. Register event listeners
            this.registerEvents();

            this.isInitialized = true;
            logger.info("[GraphService] Initialized and worker started.");
        } catch (error) {
            logger.error("[GraphService] Initialization failed:", error);
            new Notice("Failed to initialize vault intelligence graph");
        }
    }

    /**
     * Registers vault event listeners to keep the index and graph in sync with file changes.
     */
    private registerEvents() {
        this.vaultManager.onModify((file) => {
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                const content = await this.vaultManager.readFile(file);
                const { basename, mtime, size } = this.vaultManager.getFileStat(file);
                const links = this.getResolvedLinks(file);
                await this.api.updateFile(file.path, content, mtime, size, basename, links);
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
    /**
     * Debounces and schedules a save of the graph state to disk.
     * Uses requestIdleCallback for low-priority background persistence.
     */
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

    /**
     * Internal method to fetch state from worker and write binary MessagePack to vault.
     */
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

    /**
     * Internal method to load state from vault and push to worker.
     * Handles migration from legacy JSON format.
     */
    private async loadState() {
        if (!this.api) return;

        const dataPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`;
        const legacyPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`;

        // 1. Try loading MessagePack (Preferred)
        if (await this.plugin.app.vault.adapter.exists(dataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(dataPath);
                logger.debug(`[GraphService] Reading index: ${stateBuffer.byteLength} bytes`);
                // Transfer buffer to worker
                const success = await this.api.loadIndex(new Uint8Array(stateBuffer));
                if (success) {
                    logger.info("[GraphService] State loaded (MessagePack).");
                    return;
                }
                // Fallthrough implies incompatibility check failed in worker
                logger.warn("[GraphService] State incompatible. Triggering migration.");
            } catch (error) {
                logger.error("[GraphService] Load failed (MessagePack):", error);
            }
        }

        // 2. Fallback to Legacy JSON (Migration)
        if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(legacyPath);
                // Legacy always implies migration needed for this update, but let's try generic load
                const success = await this.api.loadIndex(stateJson);
                if (success) {
                    logger.info("[GraphService] State loaded (Legacy JSON).");
                    // We successfully loaded legacy, but we might want to schedule a save to convert to msgpack eventually.
                    // For now, treat as success.
                    return;
                }
            } catch (error) {
                logger.error("[GraphService] Load failed (Legacy JSON):", error);
            }
        }

        // If we reached here, either no state exists OR loading failed/was incompatible.
        // If files exist but failed to load, we should wipe.
        if (await this.plugin.app.vault.adapter.exists(dataPath) || await this.plugin.app.vault.adapter.exists(legacyPath)) {
            new Notice("Vault intelligence: upgrading index to new format...");
            this.scanAll(true).catch(err => logger.error("Migration scan failed", err));
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
            const { basename, mtime, size } = this.vaultManager.getFileStat(file);
            const links = this.getResolvedLinks(file);
            if (this.api) {
                await this.api.updateFile(path, content, mtime, size, basename, links);
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
            const map: Record<string, string> = {};

            // 1. Add all Markdown files by basename (support [[Basename]] links)
            const allFiles = this.vaultManager.getMarkdownFiles();
            for (const file of allFiles) {
                map[file.basename.toLowerCase()] = file.path;
            }

            // 2. Add Ontology Topics and Aliases (overwrites basenames if specific aliases exist)
            const topics = await ontologyService.getValidTopics();
            for (const t of topics) {
                map[t.name.toLowerCase()] = t.path;
            }

            await this.api.updateAliasMap(map);
            logger.debug(`[GraphService] Synced aliases to worker: ${topics.length} topics + ${allFiles.length} files.`);
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
     * Builds the priority payload for Dual-Loop Search (Analyst).
     * Delegates to the worker to handle parallel fetch, graph expansion, and budget packing.
     */
    public async buildPriorityPayload(queryVector: number[], query: string): Promise<unknown[]> {
        if (!this.api) return [];
        return await this.api.buildPriorityPayload(queryVector, query);
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

        const stateKeys = Object.keys(states);
        logger.debug(`[GraphService] Index has ${stateKeys.length} files. First 5 keys: ${stateKeys.slice(0, 5).join(', ')}`);

        for (const file of files) {
            const state = states[file.path];
            const { basename, mtime, size } = this.vaultManager.getFileStat(file);

            // Diagnostic: Why is it not skipping?
            if (!forceWipe && (!state || state.mtime !== mtime)) {
                if (count < 5) {
                    const reason = !state ? "missing in index" : `mtime mismatch (${state.mtime} vs ${mtime})`;
                    logger.debug(`[GraphService] Re-indexing ${file.path}: ${reason}`);
                }
            }

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
                    const links = this.getResolvedLinks(file);
                    await this.api.updateFile(file.path, content, mtime, size, basename, links);
                    count++;

                    if (count % GRAPH_CONSTANTS.SCAN_LOG_BATCH_SIZE === 0) {
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

        // Cleanup orphans (nodes in graph not in vault)
        const paths = files.map(f => f.path);
        await this.api.pruneOrphans(paths);

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
                authorName: settings.authorName,
                chatModel: settings.chatModel,
                contextAwareHeaderProperties: settings.contextAwareHeaderProperties,
                embeddingDimension: settings.embeddingDimension,
                embeddingModel: settings.embeddingModel,
                googleApiKey: settings.googleApiKey,
                indexingDelayMs: settings.indexingDelayMs,
                minSimilarityScore: settings.minSimilarityScore,
                ontologyPath: settings.ontologyPath
            });
        }
    }

    /**
     * Resolves all wikilinks in a file to their canonical paths.
     */
    private getResolvedLinks(file: TFile): string[] {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        if (!cache || !cache.links) return [];

        const resolved: string[] = [];
        for (const link of cache.links) {
            const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
            if (dest) {
                resolved.push(dest.path);
            }
        }
        return resolved;
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
