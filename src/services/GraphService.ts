import * as Comlink from 'comlink';
import { Plugin, Notice, TFile, Events } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { WorkerAPI, WorkerConfig, GraphSearchResult, GraphNodeData, FileUpdateData } from "../types/graph";
import { logger } from "../utils/logger";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService } from "./IEmbeddingService";
import { ModelRegistry } from "./ModelRegistry";
import { OntologyService } from "./OntologyService";
import { PersistenceManager } from './PersistenceManager';
import { ResultHydrator } from './ResultHydrator';
import { VaultManager } from "./VaultManager";
import { WorkerManager } from './WorkerManager';

export interface GraphState {
    graph?: {
        nodes?: Array<{ id: string; attributes?: GraphNodeData }>;
    };
}


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

    private workerManager: WorkerManager;
    private hydrator: ResultHydrator;
    private api: Comlink.Remote<WorkerAPI> | null = null;
    private isInitialized = false;
    private _isScanning = false;
    private reindexQueued = false;
    private needsForcedScan = false;
    private committedSettings: {
        embeddingChunkSize: number;
        embeddingDimension: number;
        embeddingModel: string;
        embeddingProvider: string;
    } | null = null;

    // ACTIVE WORKER STATE (Frozen for lifecycle safety)
    private activeModelId: string | null = null;
    private activeDimension: number | null = null;
    private workerSessionId: number = 0;

    // Serial queue to handle API rate limiting across all indexing tasks
    private processingQueue: Promise<unknown> = Promise.resolve();

    // Batching state
    private pendingBackgroundUpdates: Map<string, TFile> = new Map();
    private backgroundBatchTimer: ReturnType<typeof setTimeout> | null = null;

    private pendingActiveUpdate: { path: string, file: TFile } | null = null;
    private activeFileTimer: ReturnType<typeof setTimeout> | null = null;



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

        this.workerManager = new WorkerManager(plugin.app, embeddingService);
        this.hydrator = new ResultHydrator(plugin.app, vaultManager);
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
            // 1. Align settings with Model Registry
            const model = ModelRegistry.getModelById(this.settings.embeddingModel);
            if (model && model.dimensions && this.settings.embeddingDimension !== model.dimensions) {
                logger.error(`[GraphService] Dimension mismatch detected. Aligning to model.`);
                this.settings.embeddingDimension = model.dimensions;
            }

            // FREEZE STATE FOR THIS WORKER EPOCH
            this.activeModelId = this.settings.embeddingModel;
            this.activeDimension = this.settings.embeddingDimension;
            this.workerSessionId++;

            const config: WorkerConfig = {
                agentLanguage: this.settings.agentLanguage,
                authorName: this.settings.authorName,
                chatModel: this.settings.chatModel,
                contextAwareHeaderProperties: this.settings.contextAwareHeaderProperties,
                embeddingChunkSize: this.settings.embeddingChunkSize,
                embeddingDimension: this.activeDimension,
                embeddingModel: this.activeModelId,
                googleApiKey: this.settings.googleApiKey,
                indexingDelayMs: this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS,
                minSimilarityScore: this.settings.minSimilarityScore ?? 0.5,
                ontologyPath: this.settings.ontologyPath,
                sanitizedModelId: this.persistenceManager.getSanitizedModelId(this.activeModelId, this.activeDimension)
            };

            // 2. Spawn and Initialize worker via WorkerManager
            await this.workerManager.initializeWorker(config);
            this.api = this.workerManager.getApi();

            // 3. Ensure gitignore exists for data folder
            await this.persistenceManager.ensureGitignore();

            // 4. Load State
            this.needsForcedScan = await this.loadState();

            // 5. Register event listeners
            this.registerEvents();

            this.isInitialized = true;
            this.committedSettings = {
                embeddingChunkSize: this.settings.embeddingChunkSize,
                embeddingDimension: this.settings.embeddingDimension,
                embeddingModel: this.settings.embeddingModel,
                embeddingProvider: this.settings.embeddingProvider
            };
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

            // Case 2: Standard rename (Delete old, Debounce new)
            void this.enqueueIndexingTask(async () => {
                if (!this.api) return;
                await this.api.deleteFile(oldPath);
                this.requestSave();
            });

            // Queue re-indexing for the new path
            const renamedFile = this.vaultManager.getFileByPath(newPath);
            if (renamedFile) {
                this.debounceUpdate(newPath, renamedFile);
            }
        });
    }

    /**
     * Debounces and enqueues an indexing update for a specific file.
     * Uses a longer timeout for the active file (default 30s) to avoid redundant embeddings while typing.
     * Background files are batched to reduce IPC overhead.
     */
    private debounceUpdate(path: string, file: TFile) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        const isActive = activeFile?.path === path;

        if (isActive) {
            // 1. Active File Logic
            if (this.activeFileTimer) clearTimeout(this.activeFileTimer);

            // If we already have a PENDING active update for a DIFFERENT file,
            // we must downgrade it to background to ensure it's not lost.
            if (this.pendingActiveUpdate && this.pendingActiveUpdate.path !== path) {
                this.pendingBackgroundUpdates.set(this.pendingActiveUpdate.path, this.pendingActiveUpdate.file);
                this.scheduleBackgroundBatch();
            }

            // Rip it out of the background queue if it was there
            this.pendingBackgroundUpdates.delete(path);

            this.pendingActiveUpdate = { file, path };
            this.activeFileTimer = setTimeout(() => {
                const update = this.pendingActiveUpdate;
                this.pendingActiveUpdate = null;
                this.activeFileTimer = null;

                if (update) void this.processChunkInWorker([update.file]);
            }, GRAPH_CONSTANTS.ACTIVE_FILE_INDEXING_DELAY_MS);

        } else {
            // 2. Background File Logic
            // If it's the current active file's pending update, don't move it to background
            if (this.pendingActiveUpdate?.path === path) return;

            this.pendingBackgroundUpdates.set(path, file);
            this.scheduleBackgroundBatch();
        }
    }

    /**
     * Helper to schedule the background batch processing.
     */
    private scheduleBackgroundBatch() {
        if (!this.backgroundBatchTimer) {
            const delay = this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS;
            this.backgroundBatchTimer = setTimeout(() => {
                this.backgroundBatchTimer = null;
                const files = Array.from(this.pendingBackgroundUpdates.values());
                this.pendingBackgroundUpdates.clear();

                // Cap batches at 50 files or ~5MB to prevent memory spikes
                let currentChunk: TFile[] = [];
                let currentSize = 0;

                for (const f of files) {
                    currentChunk.push(f);
                    currentSize += f.stat.size;

                    if (currentChunk.length >= 50 || currentSize >= 5 * 1024 * 1024) {
                        void this.processChunkInWorker(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                }
                if (currentChunk.length > 0) void this.processChunkInWorker(currentChunk);

            }, delay);
        }
    }

    /**
     * Helper to read file contents and send them to the worker in a single IPC batch.
     */
    private processChunkInWorker(chunk: TFile[]) {
        if (chunk.length === 0) return;

        void this.enqueueIndexingTask(async () => {
            if (!this.api) return;

            const filesData: FileUpdateData[] = [];

            for (const file of chunk) {
                // Skip if deleted or excluded
                const currentFile = this.vaultManager.getFileByPath(file.path);
                if (!currentFile || this.isPathExcluded(file.path)) continue;

                const content = await this.vaultManager.readFile(currentFile);
                const { basename, mtime, size } = this.vaultManager.getFileStat(currentFile);
                const links = this.getResolvedLinks(currentFile);

                filesData.push({ content, links, mtime, path: file.path, size, title: basename });
            }

            if (filesData.length > 0) {
                logger.debug(`[GraphService] Sending IPC batch of ${filesData.length} files to worker.`);
                await this.api.updateFiles(filesData);
                this.requestSave();
                this.trigger('index-updated');
            }
        });
    }

    /**
     * Enqueues a task for the indexer worker, ensuring serial execution and rate limiting.
     */
    private async enqueueIndexingTask<T>(task: () => Promise<T>): Promise<T> {
        // Capture the session ID when the task is enqueued
        const capturedSessionId = this.workerSessionId;

        const result = this.processingQueue.then(async () => {
            // ZOMBIE GUARD: Drop task if worker has restarted since enqueue
            if (this.workerSessionId !== capturedSessionId) {
                logger.debug(`[GraphService] Dropping zombie task (Session ${capturedSessionId} vs ${this.workerSessionId})`);
                // Start a new promise chain for the next valid task, but return something safe here.
                // Since T is generic, we can't easily return a valid T. 
                // However, most callers ignore the return value or are void.
                // Throwing a specific "TaskDropped" error is cleaner and catchable.
                throw new Error("TaskDropped: Worker session changed");
            }

            const val = await task();
            const delay = this.settings.queueDelayMs || 100;
            await new Promise(resolve => setTimeout(resolve, delay));
            return val;
        });

        // Update the queue but ensure failures don't block the next task
        this.processingQueue = result.then(() => { }).catch((err) => {
            if (err instanceof Error && err.message.includes("TaskDropped")) return;
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

    private savePromise: Promise<void> | null = null;

    /**
     * Internal method to fetch state from worker and write via PersistenceManager.
     */
    private async saveState() {
        const { activeDimension, activeModelId, api } = this;
        if (!api || !activeModelId || !activeDimension) return;
        if (this.savePromise) return this.savePromise; // Lock acquired

        this.savePromise = (async () => {
            try {
                // Returns Uint8Array (MessagePack)
                const stateBuffer = await api.saveIndex();
                await this.persistenceManager.saveState(stateBuffer, activeModelId, activeDimension);
            } catch (error) {
                logger.error("[GraphService] Save failed:", error);
            } finally {
                this.savePromise = null; // Lock released
            }
        })();
        return this.savePromise;
    }

    /**
     * Internal method to load state from vault and push to worker.
     * Handles migration from legacy JSON format.
     * @returns true if migration (full scan) is needed.
     */
    private async loadState(): Promise<boolean> {
        if (!this.api || !this.activeModelId || !this.activeDimension) return false;

        const stateData = await this.persistenceManager.loadState(this.activeModelId, this.activeDimension);
        if (!stateData) {
            logger.info("[GraphService] No existing state found (checked adapter). Starting fresh scan.");
            return false;
        }

        try {
            const success = await this.api.loadIndex(stateData);
            if (success) {
                logger.info("[GraphService] State loaded (MessagePack).");
                return false;
            }

            logger.warn("[GraphService] State incompatible or corrupted. Triggering re-index.");
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
        const rawResults = await this.api.search(query, limit);
        const { driftDetected, hydrated } = await this.hydrator.hydrate(rawResults);

        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        return hydrated;
    }

    /**
     * Performs a keyword search on the Orama index.
     * @param query - The search query string.
     * @param limit - Max number of results.
     * @returns A promise resolving to an array of search results.
     */
    public async keywordSearch(query: string, limit?: number): Promise<GraphSearchResult[]> {
        if (!this.api) return [];
        const rawResults = await this.api.keywordSearch(query, limit);
        const { driftDetected, hydrated } = await this.hydrator.hydrate(rawResults);

        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        return hydrated;
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
        const rawResults = await this.api.searchInPaths(query, paths, limit);
        const { driftDetected, hydrated } = await this.hydrator.hydrate(rawResults);

        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        return hydrated;
    }

    public async getSimilar(path: string, limit?: number, minScore?: number): Promise<GraphSearchResult[]> {
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
        const rawResults = await this.api.getSimilar(path, limit, minScore);
        const { driftDetected, hydrated } = await this.hydrator.hydrate(rawResults);

        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        const threshold = minScore ?? this.settings.minSimilarityScore;
        return hydrated.filter(r => r.score >= threshold);
    }

    /**
     * DUAL-LOOP: Explorer Method.
     * Merges vector-based similarity with graph-based neighbors for a hybrid result.
     * @param path - The source file path.
     * @param limit - Maximum number of results.
     * @returns Hybrid results ranked by merged score.
     */
    public async getGraphEnhancedSimilar(path: string, limit: number): Promise<GraphSearchResult[]> {
        const weights = GRAPH_CONSTANTS.ENHANCED_SIMILAR_WEIGHTS;
        const minScore = this.settings.minSimilarityScore;

        // 1. Fetch High-Quality Vectors (permissively to allow "rescuing" near-misses)
        const permissiveFloor = Math.max(0, minScore / weights.HYBRID_MULTIPLIER);
        const [rawVectorResults, neighborResults] = await Promise.all([
            this.getSimilar(path, 50, permissiveFloor),
            this.getNeighbors(path, { direction: 'both', mode: 'ontology' })
        ]);

        const vectorResults = rawVectorResults.filter(v => v.path !== path);
        const neighborPathSet = new Set(neighborResults.map(n => n.path));
        const vectorPathSet = new Set(vectorResults.map(v => v.path));
        const mergedMap = new Map<string, GraphSearchResult>();

        // 2. Hybrid Boost
        for (const v of vectorResults) {
            if (neighborPathSet.has(v.path)) {
                v.score = Math.min(1.0, v.score * weights.HYBRID_MULTIPLIER);
                v.description = "(Enhanced semantic connection)";
            }
            mergedMap.set(v.path, v);
        }

        // 3. Discovery Anchoring
        const pureNeighbors = neighborResults
            .filter(n => !vectorPathSet.has(n.path) && n.path !== path)
            .sort((a, b) => b.score - a.score)
            .slice(0, weights.MAX_PURE_NEIGHBORS);

        const { hydrated: hydratedAnchors } = await this.hydrator.hydrate(pureNeighbors);

        // Calculate the anchor score just below the user's threshold
        const anchorScore = Math.max(0.01, minScore - 0.01);
        for (const h of hydratedAnchors) {
            h.score = anchorScore;
            h.description = "(Structural neighbor)";
            mergedMap.set(h.path, h);
        }

        // 4. Final Merge, Filter, and Sort
        return Array.from(mergedMap.values())
            .filter(r => r.score >= anchorScore) // Drop vectors that weren't rescued above the threshold
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Gets direct neighbors of a file in the graph.
     * @param path - The path of the source file.
     * @param options - Traversal options (direction, mode).
     * @returns A promise resolving to an array of neighbouring files.
     */
    public async getNeighbors(path: string, options?: GraphTraversalOptions): Promise<GraphSearchResult[]> {
        await Promise.resolve();
        if (!this.api) return [];
        const neighbors = await this.api.getNeighbors(path, options);
        const { driftDetected, hydrated } = await this.hydrator.hydrate(neighbors);

        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        return hydrated;
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
        await Promise.resolve();
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
        await Promise.resolve();
        if (!this.api) return {};
        const results = await this.api.getBatchMetadata([path]);
        return results[path] || {};
    }

    /**
     * Gets metadata for multiple nodes in a single worker call.
     * @param paths - Array of file paths.
     * @returns A promise resolving to a record of path -> metadata.
     */
    public async getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string; headers?: string[], tokenCount?: number }>> {
        await Promise.resolve();
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
        await Promise.resolve();
        if (!this.api) return {};
        const results = await this.api.getBatchCentrality(paths);
        return results;
    }

    /**
     * Builds the priority payload for Dual-Loop Search (Analyst).
     * Delegates to the worker to handle parallel fetch, graph expansion, and budget packing.
     */
    public async buildPriorityPayload(queryVector: number[], query: string): Promise<GraphSearchResult[]> {
        if (!this.api) return [];

        // 1. Get Hollow Hits from Worker
        const hollowHits = await this.api.buildPriorityPayload(queryVector, query) as GraphSearchResult[];

        // Note: buildPriorityPayload in worker now returns GraphSearchResult[] which includes tokenCount if available
        // BUT we need to ensure the Hydrator respects or passes it through.

        // 2. Hydrate on Main Thread using ResultHydrator
        const { driftDetected, hydrated } = await this.hydrator.hydrate(hollowHits);

        // 3. Trigger re-indexing for drifting files
        for (const file of driftDetected) {
            void this.debounceUpdate(file.path, file);
        }

        // 4. Mapping excerpt to content for Analyst/RAG consumers
        return hydrated.map(item => ({
            ...item,
            content: item.excerpt
        }));
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

                // Align committed snapshot with current settings after wipe
                this.committedSettings = {
                    embeddingChunkSize: this.settings.embeddingChunkSize,
                    embeddingDimension: this.settings.embeddingDimension,
                    embeddingModel: this.settings.embeddingModel,
                    embeddingProvider: this.settings.embeddingProvider,
                };
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

            let currentChunk: TFile[] = [];
            let currentSize = 0;

            const flushScanChunk = () => {
                const chunkToProcess = [...currentChunk];
                count += chunkToProcess.length;
                void this.processChunkInWorker(chunkToProcess);

                if (count % GRAPH_CONSTANTS.SCAN_LOG_BATCH_SIZE === 0 || count % 50 === 0) {
                    logger.debug(`[GraphService] Queued ${count} files for scanning...`);
                }
                currentChunk = [];
                currentSize = 0;
            };

            for (const file of files) {
                if (this.isPathExcluded(file.path)) continue;

                const state = states[file.path];
                const { mtime, size } = this.vaultManager.getFileStat(file);

                if (!shouldWipe && state && state.mtime === mtime && state.size === size) {
                    skipCount++;
                    continue;
                }

                currentChunk.push(file);
                currentSize += size;

                // Flush if we hit 50 files or 5MB
                if (currentChunk.length >= 50 || currentSize >= 5 * 1024 * 1024) {
                    flushScanChunk();
                }
            }
            if (currentChunk.length > 0) flushScanChunk();

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
        const needsReindex = this.committedSettings && (
            this.committedSettings.embeddingProvider !== settings.embeddingProvider ||
            this.committedSettings.embeddingDimension !== settings.embeddingDimension ||
            this.committedSettings.embeddingModel !== settings.embeddingModel ||
            this.committedSettings.embeddingChunkSize !== settings.embeddingChunkSize
        );

        if (needsReindex && !this.reindexQueued) {
            logger.warn("[GraphService] Embedding settings changed relative to committed state. Queueing re-scan.");
        }
        this.reindexQueued = !!needsReindex;

        this.settings = { ...settings };
        if (this.api) {
            // Push SAFE updates only.
            // DO NOT push embedding configuration (model, dimension, chunk size) to a live worker.
            // That requires a restart (handled by commitConfigChange).
            await this.api.updateConfig({
                agentLanguage: settings.agentLanguage, // Add agentLanguage if missed previously
                authorName: settings.authorName,
                chatModel: settings.chatModel,
                contextAwareHeaderProperties: settings.contextAwareHeaderProperties,
                googleApiKey: settings.googleApiKey,
                indexingDelayMs: settings.indexingDelayMs,
                minSimilarityScore: settings.minSimilarityScore,
                ontologyPath: settings.ontologyPath,
            });
        }
    }

    /**
     * Commits any queued configuration changes by restarting the worker if needed.
     * Called when the settings UI is closed.
     */
    public async commitConfigChange() {
        if (this.reindexQueued) {
            this.reindexQueued = false;
            const oldId = this.committedSettings ? this.persistenceManager.getSanitizedModelId(this.committedSettings.embeddingModel, this.committedSettings.embeddingDimension) : null;
            const newId = this.persistenceManager.getSanitizedModelId(this.settings.embeddingModel, this.settings.embeddingDimension);
            const isShardSwap = oldId !== newId;

            // 1. Save state for the OLD model/worker
            await this.forceSave();

            // 2. Terminate the old worker
            this.shutdown();

            // 3. Start fresh worker (initialize picks up the NEW settings for activeModelId)
            await this.initialize();

            // 4. Perform scan
            if (isShardSwap) {
                // Catch up the new shard with a delta scan
                void this.scanAll(false);
            } else {
                // Internal setting changed (like chunk size), force a full wipe and rebuild
                void this.scanAll(true);
            }

            // Update committed snapshot
            this.committedSettings = {
                embeddingChunkSize: this.settings.embeddingChunkSize,
                embeddingDimension: this.settings.embeddingDimension,
                embeddingModel: this.settings.embeddingModel,
                embeddingProvider: this.settings.embeddingProvider
            };
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
        if (this.backgroundBatchTimer) clearTimeout(this.backgroundBatchTimer);
        this.backgroundBatchTimer = null;
        this.pendingBackgroundUpdates.clear();

        if (this.activeFileTimer) clearTimeout(this.activeFileTimer);
        this.activeFileTimer = null;
        this.pendingActiveUpdate = null;

        if (this.workerManager) {
            this.workerManager.terminate();
        }
        this.api = null;
        this.isInitialized = false;
    }
}
