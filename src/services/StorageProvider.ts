import { logger } from "../utils/logger";

const DB_NAME = "VaultIntelligence";
const DB_VERSION = 1;
export const STORES = {
    META: "meta",       // Graph structure
    VECTORS: "vectors", // Heavy Orama blobs
};

/**
 * StorageProvider abstracts IndexedDB access for both Main Thread and Web Worker.
 * Used for the "Hot Store" in the Hybrid Slim-Sync architecture.
 */
export class StorageProvider {
    private dbPromise: Promise<IDBDatabase> | null = null;

    private openDB(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    if (!db.objectStoreNames.contains(STORES.VECTORS)) {
                        db.createObjectStore(STORES.VECTORS);
                    }
                    if (!db.objectStoreNames.contains(STORES.META)) {
                        db.createObjectStore(STORES.META);
                    }
                };

                request.onsuccess = (event) => {
                    resolve((event.target as IDBOpenDBRequest).result);
                };

                request.onerror = (event) => {
                    const error = (event.target as IDBOpenDBRequest).error || new Error("Unknown IndexedDB error");
                    logger.error("Failed to open IndexedDB:", error);
                    reject(error);
                };
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                logger.error("IndexedDB not available in this context:", error);
                reject(error);
            }
        });

        return this.dbPromise;
    }

    /**
     * Store a value in a specific object store.
     */
    public async put(storeName: string, key: string, value: unknown): Promise<void> {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.put(value, key);

            tx.oncomplete = () => resolve();
            tx.onerror = () => {
                const error = tx.error || new Error(`Put failed for ${key}`);
                logger.error(`Failed to put key "${key}" in store "${storeName}":`, error);
                reject(error);
            };
        });
    }

    /**
     * Retrieve a value from a specific object store.
     */
    public async get(storeName: string, key: string): Promise<unknown> {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const req = store.get(key);

                req.onsuccess = () => resolve(req.result);
                req.onerror = () => {
                    const error = req.error || new Error(`Get failed for ${key}`);
                    logger.error(`Failed to get key "${key}" from store "${storeName}":`, error);
                    reject(error);
                };
            });
        } catch (e) {
            logger.warn(`StorageProvider.get failed for ${storeName}/${key}:`, e);
            return null; // Handle missing DB or restricted context gracefully
        }
    }

    /**
     * Clear all stores in the database.
     */
    public async clear(): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction([STORES.VECTORS, STORES.META], "readwrite");
        tx.objectStore(STORES.VECTORS).clear();
        tx.objectStore(STORES.META).clear();

        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    }
}
