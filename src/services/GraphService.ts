import * as Comlink from 'comlink';
import { Plugin, Notice, TFile, Events } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { WorkerAPI, WorkerConfig, GraphSearchResult, GraphNodeData } from "../types/graph";
import { logger } from "../utils/logger";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService } from "./IEmbeddingService";
import { ModelRegistry } from "./ModelRegistry";
import { OntologyService } from "./OntologyService";
import { PersistenceManager } from './PersistenceManager';
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

export interface GraphTraversalOptions {
    decay?: number;
    direction?: 'both' | 'inbound' | 'outbound';
    mode?: 'simple' | 'ontology';
}

/**
 * Service responsible for managing the semantic graph and vector index.
 * It spawns and communicates with the Indexer Worker to offload heavy computation
 * and ensures that the vault's semantic state is persisted.
 */
export class GraphService extends Events {
    private plugin: Plugin;
    private vaultManager: VaultManager;
    private gemini: GeminiService;
    private embeddingService: IEmbeddingService;
    private persistenceManager: PersistenceManager;
    private settings: VaultIntelligenceSettings;

    private worker: Worker | null = null;
    private api: Comlink.Remote<WorkerAPI> | null = null;
    private isInitialized = false;
    private _isScanning = false;
    private needsForcedScan = false;

    // Serial queue to handle API rate limiting across all indexing tasks
    private processingQueue: Promise<unknown> = Promise.resolve();

    // Map to track per-file debounce timers for modification events
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();



    constructor(
        plugin: Plugin,
        vaultManager: VaultManager,
        gemini: GeminiService,
        embeddingService: IEmbeddingService,
        persistenceManager: PersistenceManager,
        settings: VaultIntelligenceSettings
    ) {
        super();
        this.plugin = plugin;
        this.vaultManager = vaultManager;
        this.gemini = gemini;
        this.embeddingService = embeddingService;
        this.persistenceManager = persistenceManager;
        this.settings = { ...settings };
    }

    /**
     * Checks if a file path is excluded from indexing based on plugin settings or system rules.
     */
    private isPathExcluded(path: string): boolean {
        // Architecture: Respect user-defined excluded folders
        if (this.settings.excludedFolders && this.settings.excludedFolders.length > 0) {
            const normalizedPath = path.toLowerCase();
            for (const folder of this.settings.excludedFolders) {
                const normalizedFolder = folder.toLowerCase().replace(/\/+$/, "");
                if (normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + '/')) {
                    return true;
                }
            }
        }

        return false;
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

            // 2. Align settings with Model Registry (Architecture Restoration)
            const model = ModelRegistry.getModelById(this.settings.embeddingModel);
            if (model && model.dimensions && this.settings.embeddingDimension !== model.dimensions) {
                logger.error(`[GraphService] Dimension mismatch detected: settings=${this.settings.embeddingDimension}, model=${model.dimensions}. Aligning to model.`);
                this.settings.embeddingDimension = model.dimensions;
                // Note: We don't save settings here to avoid side effects during init, 
                // but we use the correct dimension for the config.
            }

            const config: WorkerConfig = {
                agentLanguage: this.settings.agentLanguage,
                authorName: this.settings.authorName,
                chatModel: this.settings.chatModel,
                contextAwareHeaderProperties: this.settings.contextAwareHeaderProperties,
                embeddingChunkSize: this.settings.embeddingChunkSize,
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

            const embedder = Comlink.proxy(async (text: string, title: string) => {
                if (title === 'Query') {
                    return await this.embeddingService.embedQuery(text);
                }
                // Default: Embed as document (for indexing)
                const vectors = await this.embeddingService.embedDocument(text, title);
                return vectors[0];
            });

            // Initialize worker
            await this.api.initialize(config, fetcher, embedder);

            // 3. Ensure gitignore exists for data folder
            await this.persistenceManager.ensureGitignore();

            // 4. Load State
            this.needsForcedScan = await this.loadState();

            // 5. Register event listeners
            this.registerEvents();

            this.isInitialized = true;
            logger.info("[GraphService] Initialized and worker started.");
        } catch (error) {
            logger.error("[GraphService] Initialization failed:", error);
            new Notice("Failed to initialize vault intelligence graph");
        }
    }

    public get isReady(): boolean {
        return this.isInitialized;
    }

    public get isScanning(): boolean {
        return this._isScanning;
    }

    /**
     * Registers vault event listeners to keep the index and graph in sync with file changes.
     */
    private registerEvents() {
        this.vaultManager.onModify((file) => {
            if (this.isPathExcluded(file.path)) {
                // If it was already in the index but now excluded, we should drop it
                void this.enqueueIndexingTask(async () => {
                    if (!this.api) return;
                    await this.api.deleteFile(file.path);
                    this.requestSave();
                });
                return;
            }

            this.debounceUpdate(file.path, file);
        });

        this.vaultManager.onDelete((path) => {
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                await this.api.deleteFile(path);
                this.requestSave();
            });
        });

        this.vaultManager.onRename((oldPath, newPath) => {
            // Case 1: Renamed TO an excluded path (delete)
            if (this.isPathExcluded(newPath)) {
                void this.enqueueIndexingTask(async () => {
                    if (!this.api) return;
                    await this.api.deleteFile(oldPath);
                    this.requestSave();
                });
                return;
            }

            // Case 2: Standard rename (managed by worker updateFile subsequently)
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                await this.api.renameFile(oldPath, newPath);
                this.requestSave();
            });
        });
    }

    /**
     * Debounces and enqueues an indexing update for a specific file.
     * Uses a longer timeout for the active file (default 30s) to avoid redundant embeddings while typing.
     */
    private debounceUpdate(path: string, file: TFile) {
        const existing = this.debounceTimers.get(path);
        if (existing) {
            clearTimeout(existing);
        }

        const activeFile = this.plugin.app.workspace.getActiveFile();
        const isActive = activeFile?.path === path;

        const delay = isActive
            ? GRAPH_CONSTANTS.ACTIVE_FILE_INDEXING_DELAY_MS
            : (this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS);

        const timer = setTimeout(() => {
            this.debounceTimers.delete(path);
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                // Double check if file still exists and not excluded
                const currentFile = this.vaultManager.getFileByPath(path);
                if (!currentFile || this.isPathExcluded(path)) return;

                const content = await this.vaultManager.readFile(currentFile);
                const { basename, mtime, size } = this.vaultManager.getFileStat(currentFile);
                const links = this.getResolvedLinks(currentFile);

                logger.debug(`[GraphService] Debounce finished for ${path} (${isActive ? 'Active' : 'Background'}). Updating index.`);
                await this.api.updateFile(path, content, mtime, size, basename, links);
                this.requestSave();
            });
        }, delay);

        this.debounceTimers.set(path, timer);
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
            this.saveTimeout = undefined;
        }
        await this.saveState();
    }

    /**
     * Internal method to fetch state from worker and write via PersistenceManager.
     */
    private async saveState() {
        if (!this.api) return;
        try {
            // Returns Uint8Array (MessagePack)
            const stateBuffer = await this.api.saveIndex();
            await this.persistenceManager.saveState(stateBuffer);
        } catch (error) {
            logger.error("[GraphService] Save failed:", error);
        }
    }

    /**
     * Internal method to load state from vault and push to worker.
     * Handles migration from legacy JSON format.
     * @returns true if migration (full scan) is needed.
     */
    private async loadState(): Promise<boolean> {
        if (!this.api) return false;

        const stateData = await this.persistenceManager.loadState();
        if (!stateData) {
            logger.info("[GraphService] No existing state found (checked adapter). Starting fresh scan.");
            return false;
        }

        try {
            // If it's a Buffer/Uint8Array, treat as msgpack
            // If string, legacy JSON
            let success = false;
            if (typeof stateData === 'string') {
                success = await this.api.loadIndex(stateData);
                if (success) logger.info("[GraphService] State loaded (Legacy JSON).");
            } else {
                success = await this.api.loadIndex(stateData);
                if (success) logger.info("[GraphService] State loaded (MessagePack).");
            }

            if (success) return false;

            logger.warn("[GraphService] State incompatible or corrupted. Triggering migration.");
            return true;
        } catch (error) {
            logger.error("[GraphService] Load failed during worker ingestion:", error);
            return true;
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
            const { basename, mtime, size } = this.vaultManager.getFileStat(file);

            // OPTIMIZATION: Check if update is actually needed
            // This prevents redundant embedding generation on every view refresh
            let needsUpdate = true;
            if (this.api) {
                const state = await this.api.getFileState(path);
                if (state && state.mtime === mtime && state.size === size) {
                    needsUpdate = false;
                }
            }

            if (needsUpdate) {
                const content = await this.vaultManager.readFile(file);
                const links = this.getResolvedLinks(file);
                if (this.api) {
                    await this.api.updateFile(path, content, mtime, size, basename, links);
                }
            } else {
                logger.debug(`[GraphService] File ${path} is up to date, skipping update in getSimilar.`);
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
    public async getNeighbors(path: string, options?: GraphTraversalOptions): Promise<GraphSearchResult[]> {
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

        const shouldWipe = forceWipe || this.needsForcedScan;
        this.needsForcedScan = false;

        this._isScanning = true;
        try {
            if (shouldWipe) {
                logger.info("[GraphService] Force resetting Graph and Orama index before scan.");
                await this.api.fullReset();
            }

            // Ensure aliases are up to date before scanning content
            await this.syncAliases();

            const files = this.vaultManager.getMarkdownFiles();
            const states = await this.api.getFileStates();

            logger.info(`[GraphService] Comparing ${files.length} files against index.`);
            if (shouldWipe) {
                new Notice(`GraphService: scanning ${files.length} files`);
            }

            let count = 0;
            let skipCount = 0;

            for (const file of files) {
                if (this.isPathExcluded(file.path)) continue;

                const state = states[file.path];
                const { basename, mtime, size } = this.vaultManager.getFileStat(file);

                // OPTIMIZATION: Robust Change Detection
                // We compare both mtime and size to detect changes.
                // NOTE: We deliberately use a "Peeking" architecture here (Main thread fetches state projection)
                // rather than a "Pull" architecture (Worker requests file content). 
                // Why?
                // 1. Performance: Transferring a simplified state object (~1MB for 20k files) is much faster
                //    than 20k async round-trips for the worker to "ask" for file content.
                // 2. Simplicity: The Main Thread is the authority on the File System. The Worker is the authority
                //    on the Index. It is cleaner for the Main Thread to say "Here is the truth" than for
                //    the Worker to try to discover it through a narrow communication channel.
                if (!shouldWipe && state && state.mtime === mtime && state.size === size) {
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
                            this.requestSave();
                        }
                    } catch (error) {
                        logger.error(`[GraphService] Failed to index ${file.path}`, error);
                        // if (String(error).includes("API key")) throw error; // Don't crash loop on API key
                    }
                });
            }

            if (skipCount > 0) {
                logger.info(`[GraphService] Skipped ${skipCount} unchanged files.`);
            }

            // Wait for the entire queue to flush before saving/marking done
            await this.processingQueue;

            // Cleanup orphans (nodes in graph not in vault OR nodes now excluded)
            const paths = files.filter(f => !this.isPathExcluded(f.path)).map(f => f.path);
            await this.api.pruneOrphans(paths);

            await this.saveState();

            if (count > 0) {
                logger.info(`[GraphService] Scan complete. Total indexed: ${count}`);
                if (forceWipe) new Notice("GraphService: scan complete");
            }
        } finally {
            this._isScanning = false;
            this.trigger('index-ready');
        }
    }

    /**
     * Updates the worker configuration with new settings.
     * @param settings - The new plugin settings.
     */
    public async updateConfig(settings: VaultIntelligenceSettings) {
        // Deep clone or granularly compare before updating internal reference
        const needsReindex =
            (this.settings.embeddingDimension !== undefined && this.settings.embeddingDimension !== settings.embeddingDimension) ||
            (this.settings.embeddingModel !== undefined && this.settings.embeddingModel !== settings.embeddingModel) ||
            (this.settings.embeddingChunkSize !== undefined && this.settings.embeddingChunkSize !== settings.embeddingChunkSize);

        // Note: GraphService.settings usually shares a reference with plugin.settings.
        // We update the local reference anyway to stay in sync.
        this.settings = { ...settings };
        if (this.api) {
            await this.api.updateConfig({
                authorName: settings.authorName,
                chatModel: settings.chatModel,
                contextAwareHeaderProperties: settings.contextAwareHeaderProperties,
                embeddingChunkSize: settings.embeddingChunkSize,
                embeddingDimension: settings.embeddingDimension,
                embeddingModel: settings.embeddingModel,
                googleApiKey: settings.googleApiKey,
                indexingDelayMs: settings.indexingDelayMs,
                minSimilarityScore: settings.minSimilarityScore,
                ontologyPath: settings.ontologyPath
            });

            if (needsReindex) {
                logger.error("[GraphService] Embedding settings changed. Triggering forced re-scan.");
                new Notice("Embedding settings changed. Re-indexing vault...");
                void this.scanAll(true);
            }
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
     * Purges all data from the plugin (index, graph, and persisted files).
     * Used for clean uninstallation.
     */
    public async purgeData() {
        // 1. Stop worker
        this.shutdown();

        // 2. Wipe persisted data
        await this.persistenceManager.purgeAllData();

        logger.info("[GraphService] Data purged. Plugin requires restart to function.");
        new Notice("Data purged. Please restart plugin.");
    }

    /**
     * Terminates the worker and cleans up resources.
     */
    public shutdown() {
        // Clear all pending debounce timers
        if (this.debounceTimers.size > 0) {
            this.debounceTimers.forEach((timer) => clearTimeout(timer));
            this.debounceTimers.clear();
        }

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.api = null;
        this.isInitialized = false;
    }
}
