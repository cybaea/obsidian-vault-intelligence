import { Plugin, TFile, normalizePath } from "obsidian";

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
            const dataPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);

            // Ensure directory exists
            await this.ensureDataFolder();

            // Write binary (ensure we only write the view's bytes, not the whole underlying buffer)
            const bufferToWrite = stateBuffer.byteLength === stateBuffer.buffer.byteLength
                ? stateBuffer.buffer
                : stateBuffer.buffer.slice(stateBuffer.byteOffset, stateBuffer.byteOffset + stateBuffer.byteLength);

            // Use the adapter directly for hidden files as getAbstractFileByPath often fails for dot-files
            await this.plugin.app.vault.adapter.writeBinary(dataPath, bufferToWrite as ArrayBuffer);

            logger.info("[PersistenceManager] State persisted (MessagePack).");

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
        const vaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);
        const legacyVaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`);

        // 1. Check for state in the vault using adapter (Reliable for hidden files)
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(vaultPath);
                logger.info(`[PersistenceManager] Reading index: ${stateBuffer.byteLength} bytes`);
                return new Uint8Array(stateBuffer);
            } catch (error) {
                logger.error("[PersistenceManager] Load failed (MessagePack via adapter):", error);
            }
        }

        // 2. Migration: Check for state in the plugin folder (Legacy)
        const pluginDataPath = normalizePath(`${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);

        if (await this.plugin.app.vault.adapter.exists(pluginDataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(pluginDataPath);
                logger.info("[PersistenceManager] Migrating index from plugin folder to vault.");
                await this.saveState(new Uint8Array(stateBuffer));
                // Remove from plugin folder after migration
                await this.plugin.app.vault.adapter.remove(pluginDataPath);
                return new Uint8Array(stateBuffer);
            } catch (error) {
                logger.error("[PersistenceManager] Migration failed (MessagePack):", error);
            }
        }

        // 3. Fallback to Legacy JSON (Migration)
        if (await this.plugin.app.vault.adapter.exists(legacyVaultPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(legacyVaultPath);
                logger.debug("[PersistenceManager] Loaded legacy JSON state.");
                return stateJson;
            } catch (error) {
                logger.error("[PersistenceManager] Load failed (Legacy JSON):", error);
            }
        }

        // 4. Fallback to Legacy JSON in plugin folder
        const pluginLegacyPath = normalizePath(`${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`);
        if (await this.plugin.app.vault.adapter.exists(pluginLegacyPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(pluginLegacyPath);
                logger.info("[PersistenceManager] Loaded legacy JSON from plugin folder.");
                return stateJson;
            } catch (error) {
                logger.error("[PersistenceManager] Load failed (Legacy JSON plugin):", error);
            }
        }

        return null;
    }

    /**
     * Removes the legacy JSON state file if it exists.
     */
    private async cleanupLegacyState() {
        const legacyPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`);
        if (await this.plugin.app.vault.adapter.exists(legacyPath)) {
            await this.plugin.app.vault.adapter.remove(legacyPath);
            logger.debug("[PersistenceManager] Legacy JSON state removed.");
        }
    }

    private async ensureDataFolder() {
        const dataFolder = normalizePath(GRAPH_CONSTANTS.VAULT_DATA_DIR);
        if (!(await this.plugin.app.vault.adapter.exists(dataFolder))) {
            try {
                await this.plugin.app.vault.adapter.mkdir(dataFolder);
            } catch (error) {
                if (!(error instanceof Error && error.message.includes("already exists"))) {
                    throw error;
                }
            }
        }
    }

    /**
     * Ensures a .gitignore file exists in the data directory to ignore generated files.
     */
    public async ensureGitignore() {
        const ignorePath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/.gitignore`);
        const exists = await this.plugin.app.vault.adapter.exists(ignorePath);

        if (!exists) {
            // Ignore everything in data/ except the .gitignore itself
            const content = "# Ignore everything\n*\n!.gitignore\n";
            try {
                await this.ensureDataFolder();
                await this.plugin.app.vault.adapter.write(ignorePath, content);
                logger.debug("[PersistenceManager] Created .gitignore in data folder.");
            } catch (error) {
                if (error instanceof Error && error.message.includes("already exists")) {
                    logger.debug("[PersistenceManager] .gitignore already exists.");
                } else {
                    logger.warn("[PersistenceManager] Failed to create .gitignore:", error);
                }
            }
        }
    }

    public async wipeState(): Promise<void> {
        const vaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            await this.plugin.app.vault.adapter.remove(vaultPath);
        }
        return Promise.resolve();
    }
}
