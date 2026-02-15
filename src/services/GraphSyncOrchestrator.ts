import * as Comlink from 'comlink';
import { App, TFile, Events, Notice } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { WorkerAPI, WorkerConfig, FileUpdateData } from "../types/graph";
import { logger } from "../utils/logger";
import { OntologyService } from "./OntologyService";
import { PersistenceManager } from "./PersistenceManager";
import { VaultManager } from "./VaultManager";
import { WorkerManager } from "./WorkerManager";

export class GraphSyncOrchestrator {
    private app: App;
    private vaultManager: VaultManager;
    private workerManager: WorkerManager;
    private persistenceManager: PersistenceManager;
    private settings: VaultIntelligenceSettings;
    private ontologyService: OntologyService;
    private eventBus: Events;

    private _isScanning = false;
    public isNodeRunning = false;
    private needsForcedScan = false;
    private reindexQueued = false;
    private abortController: AbortController | null = null;
    private eventsRegistered = false;

    // Batching state
    private pendingBackgroundUpdates: Map<string, TFile> = new Map();
    private backgroundBatchTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingActiveUpdate: { path: string, file: TFile } | null = null;
    private activeFileTimer: ReturnType<typeof setTimeout> | null = null;

    // Persistence state
    private saveTimeout: number | undefined = undefined;
    private savePromise: Promise<void> | null = null;

    // Drift Quarantine (cap at 3 retries per session)
    private driftQuarantine: Map<string, number> = new Map();

    constructor(
        app: App,
        vaultManager: VaultManager,
        workerManager: WorkerManager,
        persistenceManager: PersistenceManager,
        settings: VaultIntelligenceSettings,
        ontologyService: OntologyService,
        eventBus: Events
    ) {
        this.app = app;
        this.vaultManager = vaultManager;
        this.workerManager = workerManager;
        this.persistenceManager = persistenceManager;
        this.settings = settings;
        this.ontologyService = ontologyService;
        this.eventBus = eventBus;
    }

    /**
     * Starts the synchronization orchestration.
     * Initializes the worker, loads state, and triggers scanning if needed.
     */
    public async startNode() {
        try {
            const config = this.buildWorkerConfig();
            await this.workerManager.initializeWorker(config);
            await this.persistenceManager.ensureGitignore();

            this.needsForcedScan = await this.loadState();
            this.registerEvents();

            // Initial scan (Delta or Full)
            void this.scanAll(this.needsForcedScan);

            this.isNodeRunning = true;
            logger.info("[GraphSyncOrchestrator] Started.");
        } catch (error) {
            logger.error("[GraphSyncOrchestrator] Initialization failed:", error);
            new Notice("Failed to initialize vault intelligence graph sync");
        }
    }

    private buildWorkerConfig(): WorkerConfig {
        const { dimension, id: modelId } = this.workerManager.activeModel;
        const activeModelId = modelId || this.settings.embeddingModel;
        const activeDimension = dimension || this.settings.embeddingDimension;

        return {
            agentLanguage: this.settings.agentLanguage,
            authorName: this.settings.authorName,
            chatModel: this.settings.chatModel,
            contextAwareHeaderProperties: this.settings.contextAwareHeaderProperties,
            embeddingChunkSize: this.settings.embeddingChunkSize,
            embeddingDimension: activeDimension,
            embeddingModel: activeModelId,
            googleApiKey: this.settings.googleApiKey,
            indexingDelayMs: this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS,
            minSimilarityScore: this.settings.minSimilarityScore ?? 0.5,
            ontologyPath: this.settings.ontologyPath,
            sanitizedModelId: this.persistenceManager.getSanitizedModelId(activeModelId, activeDimension)
        };
    }

    private registerEvents() {
        if (this.eventsRegistered) return;
        this.eventsRegistered = true;

        this.vaultManager.onModify((file) => {
            this.driftQuarantine.delete(file.path);
            if (this.isPathExcluded(file.path)) {
                void this.workerManager.executeMutation(api => api.deleteFile(file.path));
                this.requestSave();
                return;
            }
            this.debounceUpdate(file.path, file);
        });

        this.vaultManager.onDelete((path) => {
            this.driftQuarantine.delete(path);
            void this.workerManager.executeMutation(api => api.deleteFile(path));
            this.requestSave();
        });

        this.vaultManager.onRename((oldPath, newPath) => {
            this.driftQuarantine.delete(oldPath);
            this.driftQuarantine.delete(newPath);
            void this.workerManager.executeMutation(api => api.deleteFile(oldPath));
            const renamedFile = this.vaultManager.getFileByPath(newPath);
            if (renamedFile && !this.isPathExcluded(newPath)) {
                this.debounceUpdate(newPath, renamedFile);
            }
            this.requestSave();
        });

        // Drift bridge from Facade
        this.eventBus.on('graph:drift-detected', (file: TFile) => {
            const retryCount = this.driftQuarantine.get(file.path) || 0;
            if (retryCount < 3) {
                this.driftQuarantine.set(file.path, retryCount + 1);
                this.debounceUpdate(file.path, file);
            } else {
                logger.warn(`[GraphSyncOrchestrator] File ${file.path} quarantined due to excessive drift.`);
            }
        });
    }

    private isPathExcluded(path: string): boolean {
        if (path.startsWith(GRAPH_CONSTANTS.VAULT_DATA_DIR)) return true;
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

    private debounceUpdate(path: string, file: TFile) {
        const activeFile = this.app.workspace.getActiveFile();
        const isActive = activeFile?.path === path;

        if (isActive) {
            if (this.activeFileTimer) clearTimeout(this.activeFileTimer);
            if (this.pendingActiveUpdate && this.pendingActiveUpdate.path !== path) {
                this.pendingBackgroundUpdates.set(this.pendingActiveUpdate.path, this.pendingActiveUpdate.file);
                this.scheduleBackgroundBatch();
            }
            this.pendingBackgroundUpdates.delete(path);
            this.pendingActiveUpdate = { file, path };
            this.activeFileTimer = setTimeout(() => {
                const update = this.pendingActiveUpdate;
                this.pendingActiveUpdate = null;
                this.activeFileTimer = null;
                if (update) void this.processChunkInWorker([update.file]);
            }, GRAPH_CONSTANTS.ACTIVE_FILE_INDEXING_DELAY_MS);
        } else {
            if (this.pendingActiveUpdate?.path === path) return;
            this.pendingBackgroundUpdates.set(path, file);
            this.scheduleBackgroundBatch();
        }
    }

    private scheduleBackgroundBatch() {
        if (this.backgroundBatchTimer) return;
        const delay = this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS;
        this.backgroundBatchTimer = setTimeout(() => {
            this.backgroundBatchTimer = null;
            const files = Array.from(this.pendingBackgroundUpdates.values());
            this.pendingBackgroundUpdates.clear();

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

    private async processChunkInWorker(chunk: TFile[]) {
        if (chunk.length === 0) return;
        try {
            await this.workerManager.executeMutation(async (api) => {
                const filesData: FileUpdateData[] = [];
                for (const file of chunk) {
                    const currentFile = this.vaultManager.getFileByPath(file.path);
                    if (!currentFile || this.isPathExcluded(file.path)) continue;

                    const content = await this.vaultManager.readFile(currentFile);
                    const { basename, mtime, size } = this.vaultManager.getFileStat(currentFile);

                    // Helper to resolve links within the Orchestrator
                    const links = this.getResolvedLinks(currentFile);
                    filesData.push({ content, links, mtime, path: file.path, size, title: basename });
                }
                if (filesData.length > 0) {
                    await api.updateFiles(filesData);
                    this.requestSave();
                    this.eventBus.trigger('graph:index-updated');
                }
            });
        } catch (e) {
            if (e instanceof Error && e.message.includes("TaskDropped")) return;
            logger.error("[GraphSyncOrchestrator] Chunk processing failed:", e);
        }
    }

    private getResolvedLinks(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !cache.links) return [];
        return cache.links.map(l => {
            const dest = this.app.metadataCache.getFirstLinkpathDest(l.link, file.path);
            return dest ? dest.path : l.link;
        });
    }

    public async scanAll(forceWipe = false) {
        if (this._isScanning) return;
        this._isScanning = true;

        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            await this.workerManager.executeMutation(async (api) => {
                if (forceWipe) {
                    logger.info("[GraphSyncOrchestrator] Force resetting Graph and Orama index.");
                    await api.fullReset();
                }
                await this.syncAliases(api);
            });

            if (signal.aborted) return;

            const files = this.vaultManager.getMarkdownFiles();
            const states = await this.workerManager.executeQuery(api => api.getFileStates()) as Record<string, { mtime: number; size: number }>;

            let currentChunk: TFile[] = [];
            let currentSize = 0;

            for (const file of files) {
                if (signal.aborted) break;
                if (this.isPathExcluded(file.path)) continue;

                const state = states[file.path];
                const { mtime, size } = this.vaultManager.getFileStat(file);

                if (!state || state.mtime !== mtime || state.size !== size) {
                    currentChunk.push(file);
                    currentSize += size;
                    if (currentChunk.length >= 50 || currentSize >= 5 * 1024 * 1024) {
                        void this.processChunkInWorker(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                }
            }
            if (!signal.aborted && currentChunk.length > 0) {
                void this.processChunkInWorker(currentChunk);
            }

            // WAIT for the mutation queue to finish processing all chunks
            await this.workerManager.waitForIdle();

            if (!signal.aborted) {
                // Prune orphans (nodes that exist in graph but not in vault)
                const validPaths = files.filter(f => !this.isPathExcluded(f.path)).map(f => f.path);
                await this.workerManager.executeMutation(api => api.pruneOrphans(validPaths));

                logger.info("[GraphSyncOrchestrator] Scan complete.");
                this.eventBus.trigger('graph:index-ready');
            }
        } catch (error) {
            logger.error("[GraphSyncOrchestrator] Scan failed:", error);
        } finally {
            if (this.abortController?.signal === signal) {
                this._isScanning = false;
                this.abortController = null;
            }
        }
    }

    private async syncAliases(api: Comlink.Remote<WorkerAPI>) {
        if (typeof this.ontologyService.getValidTopics !== 'function') return;
        const map: Record<string, string> = {};
        const allFiles = this.vaultManager.getMarkdownFiles();
        for (const file of allFiles) map[file.basename.toLowerCase()] = file.path;

        const topics = await this.ontologyService.getValidTopics();
        for (const t of topics) map[t.name.toLowerCase()] = t.path;

        await api.updateAliasMap(map);
    }

    private requestSave() {
        if (this.saveTimeout) return;
        this.saveTimeout = requestIdleCallback(() => {
            this.saveTimeout = undefined;
            void this.saveState();
        }, { timeout: GRAPH_CONSTANTS.IDLE_SAVE_TIMEOUT_MS });
    }

    public cancelPendingSave() {
        if (this.saveTimeout !== undefined) {
            cancelIdleCallback(this.saveTimeout);
            this.saveTimeout = undefined;
        }
    }

    private async saveState() {
        if (this.savePromise) return this.savePromise;
        const { dimension, id: modelId } = this.workerManager.activeModel;
        if (!dimension || !modelId) return;

        this.savePromise = this.workerManager.executeQuery(async (api) => {
            try {
                const stateBuffer = await api.saveIndex();
                await this.persistenceManager.saveState(stateBuffer, modelId, dimension);
            } catch (error) {
                logger.error("[GraphSyncOrchestrator] Save failed:", error);
            } finally {
                this.savePromise = null;
            }
        });
        return this.savePromise;
    }

    /**
     * Updates the worker configuration with new settings without restarting.
     */
    public async updateConfig(settings: VaultIntelligenceSettings) {
        this.settings = { ...settings };
        const api = this.workerManager.getApi();
        if (api) {
            await api.updateConfig({
                agentLanguage: settings.agentLanguage,
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

    private async loadState(): Promise<boolean> {
        const { dimension, id: modelId } = this.workerManager.activeModel;
        if (!dimension || !modelId) return false;

        const stateData = await this.persistenceManager.loadState(modelId, dimension);
        if (!stateData) return true; // Start fresh

        return await this.workerManager.executeMutation(async (api) => {
            try {
                const success = await api.loadIndex(stateData);
                return !success;
            } catch (error) {
                logger.error("[GraphSyncOrchestrator] Load failed:", error);
                return true;
            }
        });
    }

    public async commitConfigChange() {
        this.cancelPendingSave();
        if (this.abortController) this.abortController.abort();

        // Flush timers and wait for pending mutations to finish!
        if (this.activeFileTimer) clearTimeout(this.activeFileTimer);
        if (this.backgroundBatchTimer) clearTimeout(this.backgroundBatchTimer);
        const allPending = [...Array.from(this.pendingBackgroundUpdates.values())];
        if (this.pendingActiveUpdate) allPending.push(this.pendingActiveUpdate.file);
        if (allPending.length > 0) {
            await this.processChunkInWorker(allPending);
        }
        await this.workerManager.waitForIdle();

        const { dimension: oldDimension, id: oldModelId } = this.workerManager.activeModel;
        if (oldDimension && oldModelId) {
            await this.saveState();
        }

        this.workerManager.terminate();
        this.driftQuarantine.clear();
        await this.startNode();
    }

    public async flushAndShutdown() {
        this.cancelPendingSave();
        this.isNodeRunning = false;
        if (this.abortController) this.abortController.abort();
        if (this.activeFileTimer) clearTimeout(this.activeFileTimer);
        if (this.backgroundBatchTimer) clearTimeout(this.backgroundBatchTimer);

        const allPending = [...Array.from(this.pendingBackgroundUpdates.values())];
        if (this.pendingActiveUpdate) allPending.push(this.pendingActiveUpdate.file);

        try {
            if (allPending.length > 0) {
                await this.processChunkInWorker(allPending);
            }

            // Ensure all queued mutations finish before dumping the state to disk
            await this.workerManager.waitForIdle();
            await this.saveState();
        } catch (e) {
            logger.error("[GraphSyncOrchestrator] Error during flushAndShutdown", e);
        } finally {
            this.workerManager.terminate();
        }
    }

    public get isScanning(): boolean { return this._isScanning; }
}
