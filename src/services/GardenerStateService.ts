import { App, TFile } from "obsidian";
import { logger } from "../utils/logger";

export interface FileState {
    path: string;
    lastChecked: number;        // Timestamp of last analysis (whether actioned or not)
    lastGardenerUpdate: number; // Timestamp of last applied Gardener change
    lastSkipped: number;        // Timestamp of last user rejection
}

export interface GardenerState {
    files: Record<string, FileState>;
}

/**
 * Service to manage the persistent state of Gardener analysis.
 * Stores data in 'data/gardener-state.json' within the vault.
 */
export class GardenerStateService {
    private app: App;
    private statePath = "data/gardener-state.json";
    private state: GardenerState = { files: {} };

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Loads the state from disk.
     */
    public async loadState(): Promise<void> {
        try {
            const exists = await this.app.vault.adapter.exists(this.statePath);
            if (exists) {
                const content = await this.app.vault.adapter.read(this.statePath);
                this.state = JSON.parse(content) as GardenerState;
                logger.info("GardenerState: loaded existing state.");
            } else {
                logger.info("GardenerState: no state file found, starting fresh.");
                this.state = { files: {} };
            }
        } catch (error) {
            logger.error("GardenerState: failed to load state:", error);
            this.state = { files: {} };
        }
    }

    /**
     * Saves the state to disk.
     */
    private async saveState(): Promise<void> {
        try {
            // Ensure data folder exists
            const dataFolder = "data";
            if (!(await this.app.vault.adapter.exists(dataFolder))) {
                await this.app.vault.createFolder(dataFolder);
            }

            await this.app.vault.adapter.write(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (error) {
            logger.error("GardenerState: failed to save state:", error);
        }
    }

    /**
     * Determines if a file should be processed by the Gardener.
     * Logic: 
     * 1. If never checked, process.
     * 2. If file mtime > state.lastChecked, process (it changed).
     * 3. If file was skipped by user, only process if skipRetentionDays has passed.
     */
    public shouldProcess(file: TFile, skipRetentionDays: number): boolean {
        const fileState = this.state.files[file.path];
        if (!fileState) return true;

        const now = Date.now();
        const skipRetentionMs = skipRetentionDays * 24 * 60 * 60 * 1000;

        // Recently skipped?
        if (fileState.lastSkipped > 0 && (now - fileState.lastSkipped < skipRetentionMs)) {
            return false;
        }

        // Changed since last check?
        if (file.stat.mtime > fileState.lastChecked) {
            return true;
        }

        // Default: skip (already checked and hasn't changed)
        return false;
    }

    public async recordCheck(path: string): Promise<void> {
        this.ensureFileState(path);
        const fileState = this.state.files[path];
        if (fileState) {
            fileState.lastChecked = Date.now();
            await this.saveState();
        }
    }

    public async recordUpdate(path: string): Promise<void> {
        this.ensureFileState(path);
        const fileState = this.state.files[path];
        if (fileState) {
            const now = Date.now();
            fileState.lastChecked = now;
            fileState.lastGardenerUpdate = now;
            await this.saveState();
        }
    }

    public async recordSkip(path: string): Promise<void> {
        this.ensureFileState(path);
        const fileState = this.state.files[path];
        if (fileState) {
            fileState.lastSkipped = Date.now();
            await this.saveState();
        }
    }

    private ensureFileState(path: string): void {
        if (!this.state.files[path]) {
            this.state.files[path] = {
                path,
                lastChecked: 0,
                lastGardenerUpdate: 0,
                lastSkipped: 0
            };
        }
    }
}
