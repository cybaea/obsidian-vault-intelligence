import { App, TFile, Events } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";
import { VaultManager } from "./VaultManager";

/**
 * Buffers and debounces real-time file changes from the Obsidian Vault to prevent
 * thrashing the indexing worker. Includes heuristics for active files and backpressure.
 */
export class EventDebouncer {
    private app: App;
    private vaultManager: VaultManager;
    private eventBus: Events;
    private settings: () => VaultIntelligenceSettings;
    
    // Chunk processor callback provided by Orchestrator
    private onChunkReady: (files: TFile[]) => Promise<void>;

    // Batching state
    private pendingBackgroundUpdates: Map<string, TFile> = new Map();
    private backgroundBatchTimer: number | null = null;
    private pendingActiveUpdate: { path: string, file: TFile } | null = null;
    private activeFileTimer: number | null = null;

    // Drift Quarantine (cap at 3 retries per session)
    private driftQuarantine: Map<string, number> = new Map();

    private eventsRegistered = false;
    
    // Backpressure Mechanic
    private isPaused = false;
    private pendingPausedBuffer: Set<TFile> = new Set();
    
    constructor(
        app: App,
        vaultManager: VaultManager,
        eventBus: Events,
        settingsProvider: () => VaultIntelligenceSettings,
        onChunkReady: (files: TFile[]) => Promise<void>
    ) {
        this.app = app;
        this.vaultManager = vaultManager;
        this.eventBus = eventBus;
        this.settings = settingsProvider;
        this.onChunkReady = onChunkReady;
    }

    /**
     * Registers Obsidian Vault event hooks for indexing.
     * @param onDelete Callback fired when a file is deleted.
     */
    public registerEvents(onDelete: (path: string) => void) {
        if (this.eventsRegistered) return;
        this.eventsRegistered = true;

        this.vaultManager.onModify((file) => {
            this.driftQuarantine.delete(file.path);
            if (this.isPathExcluded(file.path)) {
                onDelete(file.path);
                return;
            }
            this.debounceUpdate(file.path, file);
        });

        this.vaultManager.onDelete((path) => {
            this.driftQuarantine.delete(path);
            onDelete(path);
        });

        this.vaultManager.onRename((oldPath: string, newPath: string) => {
            this.driftQuarantine.delete(oldPath);
            this.driftQuarantine.delete(newPath);
            onDelete(oldPath);
            
            const renamedFile = this.vaultManager.getFileByPath(newPath);
            if (renamedFile && !this.isPathExcluded(newPath)) {
                this.debounceUpdate(newPath, renamedFile);
            }
        });

        // Drift bridge from Facade
        this.eventBus.on('graph:drift-detected', (...args: unknown[]) => {
            const file = args[0];
            if (!(file instanceof TFile)) return;
            const retryCount = this.driftQuarantine.get(file.path) || 0;
            if (retryCount < 3) {
                this.driftQuarantine.set(file.path, retryCount + 1);
                this.debounceUpdate(file.path, file);
            } else {
                logger.warn(`[EventDebouncer] File ${file.path} quarantined due to excessive drift.`);
            }
        });
    }

    /**
     * Checks whether a file path is excluded from indexing based on settings.
     * @param path The vault-relative file path.
     */
    public isPathExcluded(path: string): boolean {
        if (path.startsWith(GRAPH_CONSTANTS.VAULT_DATA_DIR)) return true;
        return false;
    }

    private debounceUpdate(path: string, file: TFile) {
        const activeFile = this.app.workspace.getActiveFile();
        const isActive = activeFile?.path === path;

        if (isActive) {
            if (this.activeFileTimer) activeWindow.clearTimeout(this.activeFileTimer);
            if (this.pendingActiveUpdate && this.pendingActiveUpdate.path !== path) {
                this.pendingBackgroundUpdates.set(this.pendingActiveUpdate.path, this.pendingActiveUpdate.file);
                this.scheduleBackgroundBatch();
            }
            this.pendingBackgroundUpdates.delete(path);
            this.pendingActiveUpdate = { file, path };
            this.activeFileTimer = activeWindow.setTimeout(() => {
                const update = this.pendingActiveUpdate;
                this.pendingActiveUpdate = null;
                this.activeFileTimer = null;
                if (update) {
                    void this.processBatch([update.file]);
                }
            }, GRAPH_CONSTANTS.ACTIVE_FILE_INDEXING_DELAY_MS);
        } else {
            if (this.pendingActiveUpdate?.path === path) return;
            this.pendingBackgroundUpdates.set(path, file);
            this.scheduleBackgroundBatch();
        }
    }

    private scheduleBackgroundBatch() {
        if (this.backgroundBatchTimer) return;
        const delay = this.settings().indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS;
        this.backgroundBatchTimer = activeWindow.setTimeout(() => {
            this.backgroundBatchTimer = null;
            const files = Array.from(this.pendingBackgroundUpdates.values());
            this.pendingBackgroundUpdates.clear();
            void this.processBatch(files);
        }, delay);
    }
    
    /**
     * Unified chunking logic. Enqueues an array of files by chunking them at 50 files or 5MB limits.
     * Respects backpressure and will buffer if paused.
     */
    public async processBatch(files: TFile[]) {
        if (files.length === 0) return;
        
        if (this.isPaused) {
            // Backpressure buffered
            for (const f of files) {
                this.pendingPausedBuffer.add(f);
            }
            return;
        }

        let currentChunk: TFile[] = [];
        let currentSize = 0;

        for (const f of files) {
            currentChunk.push(f);
            currentSize += f.stat.size;
            
            if (currentChunk.length >= 50 || currentSize >= 5 * 1024 * 1024) {
                await this.onChunkReady(currentChunk);
                currentChunk = [];
                currentSize = 0;
            }
        }
        
        if (currentChunk.length > 0) {
            await this.onChunkReady(currentChunk);
        }
    }
    
    /**
     * Instructs the debouncer to pause emitting chunks and start buffering them.
     */
    public pause() {
        if (this.isPaused) return;
        this.isPaused = true;
    }
    
    /**
     * Instructs the debouncer to resume and processes all buffered files immediately.
     */
    public resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        
        const buffered = Array.from(this.pendingPausedBuffer);
        this.pendingPausedBuffer.clear();
        
        if (buffered.length > 0) {
            void this.processBatch(buffered);
        }
    }
    
    /**
     * Flushes all currently pending timer updates immediately, usually before a shutdown.
     */
    public async flushPending() {
        if (this.activeFileTimer) activeWindow.clearTimeout(this.activeFileTimer);
        if (this.backgroundBatchTimer) activeWindow.clearTimeout(this.backgroundBatchTimer);

        const activeUpdate = this.pendingActiveUpdate?.file;
        this.pendingActiveUpdate = null;
        this.activeFileTimer = null;
        this.backgroundBatchTimer = null;

        const bgUpdates = Array.from(this.pendingBackgroundUpdates.values());
        this.pendingBackgroundUpdates.clear();

        const allPending = [...bgUpdates];
        if (activeUpdate) allPending.push(activeUpdate);

        if (allPending.length > 0) {
           await this.processBatch(allPending);
        }
    }

    /**
     * Clears tracking of quarantined files that drifted excessively.
     */
    public clearQuarantine() {
        this.driftQuarantine.clear();
    }
}