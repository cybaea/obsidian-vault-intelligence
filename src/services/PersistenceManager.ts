import { Plugin } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { logger } from "../utils/logger";

/**
 * Service responsible for all file I/O related to the graph state.
 * Handles saving/loading the index from the vault.
 */
export class PersistenceManager {
    private plugin: Plugin;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * Persists the graph state to the vault as a MessagePack binary.
     * @param stateBuffer The binary state data to write.
     */
    public async saveState(stateBuffer: Uint8Array): Promise<void> {
        try {
            const dataPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`;

            // Write binary (ensure we only write the view's bytes, not the whole underlying buffer)
            const bufferToWrite = stateBuffer.byteLength === stateBuffer.buffer.byteLength
                ? stateBuffer.buffer
                : stateBuffer.buffer.slice(stateBuffer.byteOffset, stateBuffer.byteOffset + stateBuffer.byteLength);

            await this.plugin.app.vault.adapter.writeBinary(dataPath, bufferToWrite as ArrayBuffer);
            logger.debug("[PersistenceManager] State persisted (MessagePack).");

            // Cleanup legacy JSON if it exists
            await this.cleanupLegacyState();

        } catch (error) {
            logger.error("[PersistenceManager] Save failed:", error);
            throw error;
        }
    }

    /**
     * Loads the graph state from the vault.
     * Attempts to load MessagePack first, then falls back to legacy JSON.
     * @returns The state data as Uint8Array (for msgpack) or string (for legacy JSON), or null if none.
     */
    public async loadState(): Promise<Uint8Array | string | null> {
        const dataPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`;
        const legacyPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`;

        // 1. Try loading MessagePack (Preferred)
        if (await this.plugin.app.vault.adapter.exists(dataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(dataPath);
                logger.debug(`[PersistenceManager] Reading index: ${stateBuffer.byteLength} bytes`);
                return new Uint8Array(stateBuffer);
            } catch (error) {
                logger.error("[PersistenceManager] Load failed (MessagePack):", error);
            }
        }

        // 2. Fallback to Legacy JSON (Migration)
        if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(legacyPath);
                logger.debug("[PersistenceManager] Loaded legacy JSON state.");
                return stateJson;
            } catch (error) {
                logger.error("[PersistenceManager] Load failed (Legacy JSON):", error);
            }
        }

        return null;
    }

    /**
     * Removes the legacy JSON state file if it exists.
     */
    private async cleanupLegacyState() {
        const legacyPath = `${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`;
        if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
            await this.plugin.app.vault.adapter.remove(legacyPath);
            logger.debug("[PersistenceManager] Legacy JSON state removed.");
        }
    }

    /**
     * Ensures a .gitignore file exists in the data directory to ignore generated files.
     */
    public async ensureGitignore() {
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
                logger.debug("[PersistenceManager] Created .gitignore in data folder.");
            } catch (error) {
                logger.warn("[PersistenceManager] Failed to create data/.gitignore:", error);
            }
        }
    }

    public async wipeState(): Promise<void> {
        // We might want to wipe checks here?
        // GraphService.scanAll(true) calls this.api.fullReset() which wipes memory.
        // But if we want to wipe disk:
        // (Not strictly required by Refactor Plan but good practice)
        return Promise.resolve();
    }
}
