import { Plugin, normalizePath } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { logger } from "../utils/logger";
import { StorageProvider, STORES } from "./StorageProvider";

/**
 * Service responsible for all file I/O related to the graph state.
 * Handles saving/loading the index from the vault.
 */
export class PersistenceManager {
    private plugin: Plugin;
    private storage: StorageProvider;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.storage = new StorageProvider();
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

            // 1. Save to "Hot Store" (IndexedDB) for fast local access
            // We store the raw buffer in IDB. The worker also does this directly, 
            // but the main thread can do it here for redundancy or initial setup.
            await this.storage.put(STORES.VECTORS, "orama_index_buffer", stateBuffer);

            // 2. Save to "Cold Store" (Vault File) for cross-device sync
            const bufferToWrite = stateBuffer.byteLength === stateBuffer.buffer.byteLength
                ? stateBuffer.buffer
                : stateBuffer.buffer.slice(stateBuffer.byteOffset, stateBuffer.byteOffset + stateBuffer.byteLength);

            await this.plugin.app.vault.adapter.writeBinary(dataPath, bufferToWrite as ArrayBuffer);

            logger.info("[PersistenceManager] Hybrid State persisted (IDB + Vault).");

            // Cleanup legacy formats
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

        // 1. Try "Hot Store" (IndexedDB) first
        try {
            const hotState = await this.storage.get(STORES.VECTORS, "orama_index_buffer");
            if (hotState instanceof Uint8Array) {
                logger.info(`[PersistenceManager] Loaded from Hot Store (IDB): ${hotState.byteLength} bytes`);
                return hotState;
            }
        } catch {
            logger.warn("[PersistenceManager] No state found in Hot Store (IDB), checking Cold Store (Vault).");
        }

        // 2. Fallback to "Cold Store" (Vault File) - Sync Source
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(vaultPath);
                const uint8 = new Uint8Array(stateBuffer);
                logger.info(`[PersistenceManager] Loaded from Cold Store (Vault): ${uint8.byteLength} bytes`);

                // Hydrate Hot Store
                await this.storage.put(STORES.VECTORS, "orama_index_buffer", uint8);

                return uint8;
            } catch (error) {
                logger.error("[PersistenceManager] Cold Store load failed:", error);
            }
        }

        // 3. Migration: Handle legacy data locations and formats (Omitted for brevity in summary, keeping logic)
        // Check for state in the plugin folder (Legacy)
        const pluginDataPath = normalizePath(`${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);
        if (await this.plugin.app.vault.adapter.exists(pluginDataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(pluginDataPath);
                logger.info("[PersistenceManager] Migrating index from plugin folder to vault.");
                const data = new Uint8Array(stateBuffer);
                await this.saveState(data);
                await this.plugin.app.vault.adapter.remove(pluginDataPath);
                return data;
            } catch (error) {
                logger.error("[PersistenceManager] Migration failed (MessagePack):", error);
            }
        }

        // Fallback to Legacy JSON
        if (await this.plugin.app.vault.adapter.exists(legacyVaultPath)) {
            try {
                const stateJson = await this.plugin.app.vault.adapter.read(legacyVaultPath);
                return stateJson;
            } catch (error) {
                logger.error("[PersistenceManager] Legacy JSON load failed:", error);
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

        // 1. Wipe Hot Store
        await this.storage.clear();

        // 2. Wipe Cold Store
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            await this.plugin.app.vault.adapter.remove(vaultPath);
        }
    }

    /**
     * Recursively deletes the entire data directory (.vault-intelligence).
     * Used for "Purge & Reset" functionality.
     */
    public async purgeAllData(): Promise<void> {
        const dataFolder = normalizePath(GRAPH_CONSTANTS.VAULT_DATA_DIR);
        if (await this.plugin.app.vault.adapter.exists(dataFolder)) {
            try {
                // Recursive delete
                await this.plugin.app.vault.adapter.rmdir(dataFolder, true);
                logger.info("[PersistenceManager] Purged all data in .vault-intelligence");
            } catch (error) {
                logger.error("[PersistenceManager] Failed to purge data folder:", error);
                throw error;
            }
        }
    }
}
