import { App, Plugin, TFile, normalizePath } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { logger } from "../utils/logger";

export interface FileState {
    lastChecked: number;        // Timestamp of last analysis (whether actioned or not)
    lastGardenerUpdate: number; // Timestamp of last applied Gardener change
    lastSkipped: number;        // Timestamp of last user rejection
    path: string;
}

export interface GardenerState {
    files: Record<string, FileState>;
}

/**
 * Service to manage the persistent state of Gardener analysis.
 * Stores data in the plugin's data folder within the vault.
 */
export class GardenerStateService {
    private app: App;
    private plugin: Plugin;
    private state: GardenerState = { files: {} };

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    private getVaultPath(): string {
        return normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/gardener-state.json`);
    }

    /**
     * Loads the state from disk.
     */
    public async loadState(): Promise<void> {
        try {
            const vaultPath = this.getVaultPath();
            const exists = await this.app.vault.adapter.exists(vaultPath);

            if (exists) {
                const file = this.app.vault.getAbstractFileByPath(vaultPath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    this.state = JSON.parse(content) as GardenerState;
                } else {
                    // Fallback for dot-files that Vault API cannot resolve
                    const content = await this.app.vault.adapter.read(vaultPath);
                    this.state = JSON.parse(content) as GardenerState;
                }
                logger.info("GardenerState: loaded existing state from vault.");
                return;
            }

            // Migration from plugin folder
            const pluginStatePath = normalizePath(`${this.plugin.manifest.dir}/data/gardener-state.json`);
            if (await this.app.vault.adapter.exists(pluginStatePath)) {
                try {
                    const content = await this.app.vault.adapter.read(pluginStatePath);
                    this.state = JSON.parse(content) as GardenerState;
                    logger.info("GardenerState: migrating state from plugin folder to vault.");
                    await this.saveState();
                    await this.app.vault.adapter.remove(pluginStatePath);
                    return;
                } catch (error) {
                    logger.error("GardenerState: migration failed:", error);
                }
            }

            logger.info("GardenerState: no state found, starting fresh.");
            this.state = { files: {} };
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
            const vaultPath = this.getVaultPath();
            const dataFolder = normalizePath(GRAPH_CONSTANTS.VAULT_DATA_DIR);

            if (!(await this.app.vault.adapter.exists(dataFolder))) {
                try {
                    await this.app.vault.createFolder(dataFolder);
                } catch (error) {
                    if (!(error instanceof Error && error.message.includes("already exists"))) {
                        throw error;
                    }
                }
            }

            const content = JSON.stringify(this.state, null, 2);
            if (await this.app.vault.adapter.exists(vaultPath)) {
                const file = this.app.vault.getAbstractFileByPath(vaultPath);
                if (file instanceof TFile) {
                    await this.app.vault.modify(file, content);
                } else {
                    await this.app.vault.adapter.write(vaultPath, content);
                }
            } else {
                try {
                    await this.app.vault.create(vaultPath, content);
                } catch (error) {
                    if (error instanceof Error && error.message.includes("already exists")) {
                        await this.app.vault.adapter.write(vaultPath, content);
                    } else {
                        throw error;
                    }
                }
            }
        } catch (error) {
            logger.error("GardenerState: failed to save state:", error);
        }
    }

    /**
     * Determines if a file should be processed by the Gardener.
     * Logic: 
     * 1. If never checked, process.
     * 2. If file mtime > state.lastChecked, process (it changed).
     * 3. If file was recently skipped by user (within skipRetentionDays), skip.
     * 4. If recheckHours > 0 and time since lastChecked > recheckHours, process (cooldown expired).
     */
    public shouldProcess(file: TFile, skipRetentionDays: number, recheckHours: number): boolean {
        const fileState = this.state.files[file.path];
        if (!fileState) return true;

        const now = Date.now();
        const skipRetentionMs = skipRetentionDays * 24 * 60 * 60 * 1000;
        const recheckMs = recheckHours * 60 * 60 * 1000;

        // 1. Recently skipped by user?
        if (fileState.lastSkipped > 0 && (now - fileState.lastSkipped < skipRetentionMs)) {
            return false;
        }

        // 2. Changed since last check?
        if (file.stat.mtime > fileState.lastChecked) {
            return true;
        }

        // 3. Has the cooldown expired?
        if (recheckHours > 0 && (now - fileState.lastChecked > recheckMs)) {
            return true;
        }

        // Default: skip (already checked, hasn't changed, and cooldown hasn't expired)
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
                lastChecked: 0,
                lastGardenerUpdate: 0,
                lastSkipped: 0,
                path
            };
        }
    }
}
