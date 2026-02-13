import { decodeMulti } from "@msgpack/msgpack";
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
 * @param modelId The ID of the model used to generate the state.
 * @param dimension The dimension of the model.
 */
    public async saveState(stateBuffer: Uint8Array, modelId: string, dimension: number): Promise<void> {
        try {
            const sanitizedId = this.getSanitizedModelId(modelId, dimension);
            const dataPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/graph-state-${sanitizedId}.msgpack`);

            // Ensure directory exists
            await this.ensureDataFolder();

            // 1. Save to "Hot Store" (IndexedDB) for fast local access
            // We namespace the key to ensure multiple models don't overwrite each other
            await this.storage.put(STORES.VECTORS, `orama_index_buffer_${sanitizedId}`, stateBuffer);

            // 2. Save to "Cold Store" (Vault File) for cross-device sync
            const bufferToWrite = stateBuffer.byteLength === stateBuffer.buffer.byteLength
                ? stateBuffer.buffer
                : stateBuffer.buffer.slice(stateBuffer.byteOffset, stateBuffer.byteOffset + stateBuffer.byteLength);

            await this.plugin.app.vault.adapter.writeBinary(dataPath, bufferToWrite as ArrayBuffer);

            logger.info(`[PersistenceManager] Sharded State persisted (IDB + Vault): ${sanitizedId}`);

            // 3. One-time Migration & Cleanup
            await this.handleMigrations(modelId, dimension);
            await this.cleanupLegacyState();

        } catch (error) {
            logger.error("[PersistenceManager] Save failed:", error);
            throw error;
        }
    }

    /**
     * Loads the graph state from the vault.
     * Attempts to load MessagePack first, then falls back to legacy JSON.
     * @param modelId The ID of the currently active model.
     * @param dimension The dimension of the model.
     * @returns The state data as Uint8Array (for msgpack) or string (for legacy JSON), or null if none.
     */
    public async loadState(modelId: string, dimension: number): Promise<Uint8Array | string | null> {
        const sanitizedId = this.getSanitizedModelId(modelId, dimension);
        const vaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/graph-state-${sanitizedId}.msgpack`);

        // 1. Check for legacy file needing migration (Sync Conflict / Legacy Boot)
        await this.handleMigrations(modelId, dimension);

        // 2. Try "Hot Store" (IndexedDB) first (Namespaced)
        try {
            const hotState = await this.storage.get(STORES.VECTORS, `orama_index_buffer_${sanitizedId}`);
            if (hotState instanceof Uint8Array) {
                logger.info(`[PersistenceManager] Loaded from Hot Store (IDB): ${hotState.byteLength} bytes`);
                return hotState;
            }
        } catch {
            logger.warn(`[PersistenceManager] No state for ${sanitizedId} in Hot Store (IDB), checking Cold Store (Vault).`);
        }

        // 3. Fallback to "Cold Store" (Vault File) - Sync Source
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(vaultPath);
                const uint8 = new Uint8Array(stateBuffer);
                logger.info(`[PersistenceManager] Loaded from Cold Store (Vault): ${uint8.byteLength} bytes`);

                // Hydrate Hot Store
                await this.storage.put(STORES.VECTORS, `orama_index_buffer_${sanitizedId}`, uint8);

                return uint8;
            } catch (error) {
                logger.error("[PersistenceManager] Cold Store load failed:", error);
            }
        }

        // 4. Final Fallback: Handle original legacy data locations and JSON
        return await this.loadLegacyJSON();
    }

    /**
     * Handles migration and sync-conflict resolution.
     * Inspects legacy or generic files to identify their true model ID.
     */
    private async handleMigrations(currentModelId: string, currentDimension: number) {
        const legacyPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);
        if (!(await this.plugin.app.vault.adapter.exists(legacyPath))) return;

        try {
            // Peek inside the legacy file to see who it belongs to
            const buffer = await this.plugin.app.vault.adapter.readBinary(legacyPath);
            // Use decodeMulti to gracefully handle extra padding bytes found in some environments
            const generator = decodeMulti(new Uint8Array(buffer));
            const state = generator.next().value as { embeddingDimension?: number; embeddingModel?: string };

            // Expected metadata fields in SerializedIndexState (Top Level)
            const actualModelId = state.embeddingModel;
            const actualDimension = state.embeddingDimension;

            if (actualModelId && actualDimension) {
                const targetSanitizedId = this.getSanitizedModelId(actualModelId, actualDimension);
                const targetPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/graph-state-${targetSanitizedId}.msgpack`);

                // DIMENSION SAFETY / GHOST MIGRATION GUARD
                const alreadyExists = await this.plugin.app.vault.adapter.exists(targetPath);
                if (!alreadyExists) {
                    logger.info(`[PersistenceManager] Migrating legacy file to sharded format: ${targetSanitizedId}`);
                    // We can just rename it
                    await this.plugin.app.vault.adapter.writeBinary(targetPath, buffer);
                } else {
                    logger.info(`[PersistenceManager] Stale legacy file found but healthy shard exists. Deleting legacy.`);
                }

                // Always delete the generic legacy file after handling
                await this.plugin.app.vault.adapter.remove(legacyPath);
            } else {
                logger.warn("[PersistenceManager] Found malformed legacy state file. Removing.");
                await this.plugin.app.vault.adapter.remove(legacyPath);
            }
        } catch (e) {
            logger.error("[PersistenceManager] Migration peek failed:", e);
            // If it's totally unreadable, we must remove it to prevent boot loops
            await this.plugin.app.vault.adapter.remove(legacyPath);
        }
    }

    private async loadLegacyJSON(): Promise<string | null> {
        const legacyVaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.legacy_STATE_FILE}`);
        const pluginDataPath = normalizePath(`${this.plugin.manifest.dir}/${GRAPH_CONSTANTS.DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);

        // Check for state in the plugin folder (Legacy)
        if (await this.plugin.app.vault.adapter.exists(pluginDataPath)) {
            try {
                const stateBuffer = await this.plugin.app.vault.adapter.readBinary(pluginDataPath);
                logger.info("[PersistenceManager] Migrating index from plugin folder to vault.");
                // Note: We don't have modelId/dim here easily, so we just move it to the generic path 
                // and let 'handleMigrations' deal with it on next boot/save.
                const legacyPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${GRAPH_CONSTANTS.STATE_FILE}`);
                await this.ensureDataFolder();
                await this.plugin.app.vault.adapter.writeBinary(legacyPath, stateBuffer);
                await this.plugin.app.vault.adapter.remove(pluginDataPath);
            } catch (error) {
                logger.error("[PersistenceManager] Migration failed (Plugin Folder):", error);
            }
        }

        // Fallback to Legacy JSON
        if (await this.plugin.app.vault.adapter.exists(legacyVaultPath)) {
            try {
                return await this.plugin.app.vault.adapter.read(legacyVaultPath);
            } catch (error) {
                logger.error("[PersistenceManager] Legacy JSON load failed:", error);
            }
        }
        return null;
    }

    private fastHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }

    public getSanitizedModelId(modelId: string, dimension: number): string {
        const base = modelId.replace(/[^a-z0-9-]/gi, '_').toLowerCase().substring(0, 30);
        const hash = this.fastHash(modelId);
        return `${base}-${dimension}-${hash}`;
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

    /**
     * Checks if the stored data version matches the current plugin version.
     * @returns True if versions match, false if migration/wipe is needed.
     */
    public async checkDataVersion(currentVersion: number): Promise<boolean> {
        const versionPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/data_version`);

        if (!(await this.plugin.app.vault.adapter.exists(versionPath))) {
            return false;
        }

        try {
            const versionStr = await this.plugin.app.vault.adapter.read(versionPath);
            const version = parseInt(versionStr, 10);
            return version === currentVersion;
        } catch (error) {
            logger.warn("[PersistenceManager] Failed to read data version:", error);
            return false;
        }
    }

    /**
     * Updates the stored data version to the current plugin version.
     */
    public async updateDataVersion(version: number): Promise<void> {
        const versionPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/data_version`);
        try {
            await this.ensureDataFolder();
            await this.plugin.app.vault.adapter.write(versionPath, version.toString());
            logger.debug(`[PersistenceManager] Updated data version to ${version}.`);
        } catch (error) {
            logger.error("[PersistenceManager] Failed to update data version:", error);
        }
    }

    public async wipeState(modelId: string, dimension: number): Promise<void> {
        const sanitizedId = this.getSanitizedModelId(modelId, dimension);
        const vaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/graph-state-${sanitizedId}.msgpack`);

        // 1. Wipe Hot Store (Namespaced)
        await this.storage.delete(STORES.VECTORS, `orama_index_buffer_${sanitizedId}`);

        // 2. Wipe Cold Store (Sharded)
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            await this.plugin.app.vault.adapter.remove(vaultPath);
        }
    }

    /**
     * Lists all available model database files in the vault.
     */
    public async listAvailableStates(): Promise<string[]> {
        const dataFolder = normalizePath(GRAPH_CONSTANTS.VAULT_DATA_DIR);
        if (!(await this.plugin.app.vault.adapter.exists(dataFolder))) return [];

        const files = await this.plugin.app.vault.adapter.list(dataFolder);
        return files.files
            .filter(f => f.endsWith(".msgpack") && f.includes("graph-state-"))
            .map(f => f.split("/").pop() || "");
    }

    /**
     * Deletes a specific state file and its IDB keys.
     */
    public async deleteState(fileName: string): Promise<void> {
        const vaultPath = normalizePath(`${GRAPH_CONSTANTS.VAULT_DATA_DIR}/${fileName}`);
        // 1. Delete File
        if (await this.plugin.app.vault.adapter.exists(vaultPath)) {
            await this.plugin.app.vault.adapter.remove(vaultPath);
        }

        // 2. Attempt to extract IDB key from filename
        // Filename: graph-state-<sanitizedId>.msgpack
        const match = fileName.match(/graph-state-(.+)\.msgpack/);
        if (match && match[1]) {
            await this.storage.delete(STORES.VECTORS, `orama_index_buffer_${match[1]}`);
            await this.storage.delete(STORES.VECTORS, `orama_index_${match[1]}`);
        }
    }

    /**
     * Recursively deletes the entire data directory (.vault-intelligence).
     * Used for "Purge & Reset" functionality.
     */
    public async purgeAllData(): Promise<void> {
        const dataFolder = normalizePath(GRAPH_CONSTANTS.VAULT_DATA_DIR);

        // 1. Optimal IDB Wipe (Full reset)
        await this.storage.clear();

        // 2. Vault Wipe
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
