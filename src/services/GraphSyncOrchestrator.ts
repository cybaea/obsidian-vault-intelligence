import * as Comlink from 'comlink';
import { App, TFile, Events, Notice, normalizePath } from "obsidian";

import { DOCUMENTATION_URLS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { FileUpdateData, WorkerAPI } from "../types/graph";
import { logger } from "../utils/logger";
import { EventDebouncer } from "./EventDebouncer";
import { OntologyService } from "./OntologyService";
import { PersistenceManager } from "./PersistenceManager";
import { VaultManager } from "./VaultManager";
import { WorkerLifecycleManager } from "./WorkerLifecycleManager";
import { WorkerManager } from "./WorkerManager";

export class GraphSyncOrchestrator {
    private app: App;
    private vaultManager: VaultManager;
    private workerManager: WorkerManager;
    private eventBus: Events;
    private ontologyService: OntologyService;
    private settings: VaultIntelligenceSettings;

    // Sub-Managers
    private lifecycleManager: WorkerLifecycleManager;
    private eventDebouncer: EventDebouncer;

    private _isScanning = false;
    private abortController: AbortController | null = null;

    // Error Throttling
    private lastErrorNoticeTime = 0;

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
        this.eventBus = eventBus;
        this.ontologyService = ontologyService;
        this.settings = settings;

        this.lifecycleManager = new WorkerLifecycleManager(
            workerManager,
            persistenceManager,
            ontologyService,
            settings
        );

        this.eventDebouncer = new EventDebouncer(
            app,
            vaultManager,
            eventBus,
            () => this.settings, // Dynamic getter
            this.processChunkInWorker.bind(this)
        );
    }

    public get isNodeRunning(): boolean {
        return this.lifecycleManager.isNodeRunning;
    }

    public get isScanning(): boolean {
        return this._isScanning;
    }

    /**
     * Starts the synchronization orchestration.
     */
    public async startNode(forceWipe = false) {
        try {
            const needsForcedScan = await this.lifecycleManager.initializeWorker(forceWipe);
            
            this.eventDebouncer.registerEvents((path) => {
                void this.workerManager.executeMutation(api => api.deleteFile(path));
                this.lifecycleManager.requestSave();
            });

            // Initial scan (Delta or Full)
            void this.scanAll(needsForcedScan);
        } catch {
            new Notice("Failed to initialize vault intelligence graph sync");
        }
    }

    private async processChunkInWorker(chunk: TFile[]) {
        if (chunk.length === 0) return;
        try {
            await this.workerManager.executeMutation(async (api) => {
                const filesData: FileUpdateData[] = [];
                for (const file of chunk) {
                    const currentFile = this.vaultManager.getFileByPath(file.path);
                    if (!currentFile || this.eventDebouncer.isPathExcluded(file.path)) continue;

                    const content = await this.vaultManager.readFile(currentFile);
                    const { basename, mtime, size } = this.vaultManager.getFileStat(currentFile);

                    const links = this.getResolvedLinks(currentFile);
                    filesData.push({ content, links, mtime, path: file.path, size, title: basename });
                }
                if (filesData.length > 0) {
                    await api.updateFiles(filesData);
                    this.lifecycleManager.requestSave();
                    this.eventBus.trigger('graph:index-updated');
                }
            });
        } catch (e) {
            if (e instanceof Error && e.message.includes("TaskDropped")) return;
            logger.error("[GraphSyncOrchestrator] Chunk processing failed:", e);

            // Throttle UI Error Notices to once every 30 seconds to prevent spam
            if (!this.lastErrorNoticeTime || Date.now() - this.lastErrorNoticeTime > 30000) {
                this.lastErrorNoticeTime = Date.now();
                const notice = new Notice(
                    "Background indexing failed. Is your AI provider offline?\n\nCheck the developer console for details or ",
                    10000
                );

                notice.messageEl.createEl('a', {
                    href: DOCUMENTATION_URLS.SECTIONS.OLLAMA_DEBUG,
                    text: `View the ${'Ollama'} guide to troubleshoot`
                });
            }
        }
    }

    private getResolvedLinks(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const allLinks = [...(cache.links || []), ...(cache.frontmatterLinks || [])];
        if (allLinks.length === 0) return [];

        return allLinks.map(l => {
            let cleanLink = l.link;
            try {
                cleanLink = decodeURIComponent(cleanLink).split('#')[0] || cleanLink;
                cleanLink = normalizePath(cleanLink);
            } catch {
                // Ignore decoding errors
            }
            const dest = this.app.metadataCache.getFirstLinkpathDest(cleanLink, file.path);
            return dest ? dest.path : cleanLink;
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

            const filesToProcess: TFile[] = [];

            for (const file of files) {
                if (signal.aborted) break;
                if (this.eventDebouncer.isPathExcluded(file.path)) continue;

                const state = states[file.path];
                const { mtime, size } = this.vaultManager.getFileStat(file);

                if (!state || state.mtime !== mtime || state.size !== size) {
                    filesToProcess.push(file);
                }
            }

            if (!signal.aborted && filesToProcess.length > 0) {
                // Delegate chunking and dispatch to EventDebouncer
                await this.eventDebouncer.processBatch(filesToProcess);
            }

            // WAIT for the mutation queue to finish processing all chunks
            await this.workerManager.waitForIdle();

            if (!signal.aborted) {
                // Prune orphans (nodes that exist in graph but not in vault)
                const validPaths = files.filter(f => !this.eventDebouncer.isPathExcluded(f.path)).map(f => f.path);
                await this.workerManager.executeMutation(api => api.pruneOrphans(validPaths));

                logger.info("[GraphSyncOrchestrator] Scan complete.");
                this._isScanning = false;
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
        for (const file of allFiles) {
            map[file.basename.toLowerCase()] = file.path;
            map[file.path.toLowerCase()] = file.path;
        }

        const topics = await this.ontologyService.getValidTopics();
        for (const t of topics) {
            map[t.name.toLowerCase()] = t.path;
            map[t.path.toLowerCase()] = t.path;
        }

        await api.updateAliasMap(map);
    }

    public async updateConfig(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        await this.lifecycleManager.updateConfig(settings);
    }

    public cancelPendingSave() {
        this.lifecycleManager.cancelPendingSave();
    }

    public async commitConfigChange(forceWipe = false) {
        if (this.abortController) this.abortController.abort();

        // 1. Tell EventDebouncer to Pause its batch execution
        this.eventDebouncer.pause();
        
        // 2. Synchronously halt all UI timers and flush pending updates into the internal buffer
        await this.eventDebouncer.flushPending();

        // 3. Ensure prior worker updates have finished
        await this.workerManager.waitForIdle();

        // 4. Safe to shutdown worker, save old state, restart
        const needsForcedScan = await this.lifecycleManager.commitRestart(forceWipe);

        // 5. Clear transient error tracking
        this.eventDebouncer.clearQuarantine();

        // 6. Tell EventDebouncer to Resume, flushing the buffer 
        this.eventDebouncer.resume();

        // 7. Rescan
        void this.scanAll(needsForcedScan);
    }

    public async flushAndShutdown() {
        if (this.abortController) this.abortController.abort();
        
        // Block new timer pushes and flush them into the processing buffer
        this.eventDebouncer.pause();
        await this.eventDebouncer.flushPending();
        
        // Clear any buffered entries manually since we are shutting down
        // (Wait, flushPending forces processBatch, but since we are paused, they get bufferd.
        // Actually flushPending should probably bypass pause during a final shutdown, or we 
        // should do resume right after flushPending before shutdown. Let's do resume).
        this.eventDebouncer.resume();
        
        // Worker shutdown handles saving state
        await this.lifecycleManager.shutdownWorker();
    }
}
