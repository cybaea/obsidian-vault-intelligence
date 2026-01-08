import { TFile, Notice, Plugin, normalizePath } from "obsidian";
import { IEmbeddingService } from "./IEmbeddingService";
import { GeminiService } from "./GeminiService";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings";

const DATA_DIR = "data";
const INDEX_FILE = "index.json";
const VECTORS_FILE = "vectors.bin";

interface VectorEntry {
    ids: number[]; // Changed from 'id' to 'ids'
    mtime: number;
    path: string;
}

interface VectorIndex {
    version: number;
    embeddingModel: string;
    dimensions: number;
    files: { [path: string]: VectorEntry };
}

export class VectorStore {
    private plugin: Plugin;
    private gemini: GeminiService;
    private embeddingService: IEmbeddingService;
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();
    private settings: VaultIntelligenceSettings;
    private consecutiveErrors = 0;
    private readonly MAX_ERRORS_BEFORE_BACKOFF = 5;

    // Data Store
    private index: VectorIndex;
    private vectors: Float32Array = new Float32Array(0);
    // NEW: In-memory reverse index for fast lookups (Vector ID -> File Path)
    private vectorIdToPath: string[] = [];

    // Concurrency Control
    private requestQueue: (() => Promise<void>)[] = [];
    private activeRequests = 0;
    private readonly MAX_CONCURRENT_REQUESTS = 1;
    private baseDelayMs: number;
    private currentDelayMs: number;
    private minSimilarityScore: number;
    private isBackingOff = false;
    private similarNotesLimit: number;
    private isDirty = false;
    private isReindexing = false;

    constructor(plugin: Plugin, gemini: GeminiService, embeddingService: IEmbeddingService, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.gemini = gemini;
        this.embeddingService = embeddingService;
        this.settings = settings;

        this.index = {
            version: 1,
            embeddingModel: this.embeddingService.modelName,
            dimensions: this.embeddingService.dimensions,
            files: {}
        };
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.baseDelayMs = settings.indexingDelayMs || 200;
        this.minSimilarityScore = settings.minSimilarityScore ?? 0.5;
        this.similarNotesLimit = settings.similarNotesLimit ?? 5;
        if (!this.isBackingOff) {
            this.currentDelayMs = this.baseDelayMs;
        }
    }

    private getDataPath(filename: string): string {
        return normalizePath(`${this.plugin.manifest.dir}/${DATA_DIR}/${filename}`);
    }

    private async ensureDataDir() {
        const dataPath = normalizePath(`${this.plugin.manifest.dir}/${DATA_DIR}`);
        if (!(await this.plugin.app.vault.adapter.exists(dataPath))) {
            await this.plugin.app.vault.createFolder(dataPath);
        }
    }

    public async loadVectors() {
        await this.ensureDataDir();
        const indexPath = this.getDataPath(INDEX_FILE);
        const vectorsPath = this.getDataPath(VECTORS_FILE);

        // 1. Load Index
        if (await this.plugin.app.vault.adapter.exists(indexPath)) {
            try {
                const indexStr = await this.plugin.app.vault.adapter.read(indexPath);
                // Cast to unknown first for safe processing
                const loadedRaw = JSON.parse(indexStr) as Record<string, unknown>;

                // Compatibility Update: Convert old 'id' entries to 'ids' if needed
                const files = loadedRaw.files;
                if (files && typeof files === 'object' && files !== null && !Array.isArray(files)) {
                    const filesMap = files as Record<string, Record<string, unknown>>;
                    for (const key in filesMap) {
                        const entry = filesMap[key];
                        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                            if ('id' in entry && !('ids' in entry)) {
                                entry.ids = [entry.id];
                                delete entry.id;
                            }
                        }
                    }
                }
                this.index = loadedRaw as unknown as VectorIndex;

                const modelChanged = this.index.embeddingModel !== this.embeddingService.modelName;
                const dimChanged = this.index.dimensions !== this.embeddingService.dimensions;

                if (modelChanged || dimChanged) {
                    const reason = modelChanged ? "Model changed" : "Dimension changed";
                    logger.warn(`${reason}. Wiping index to rebuild.`);
                    await this.reindexVault(); // Use reindex logic
                    return;
                }
                logger.info(`Loaded index for ${Object.keys(this.index.files).length} files.`);
            } catch (e) {
                logger.error("Failed to load index.json", e);
                this.resetIndex();
            }
        }

        // 2. Load Binary Vectors
        if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
            try {
                const buffer = await this.plugin.app.vault.adapter.readBinary(vectorsPath);
                this.vectors = new Float32Array(buffer);
                this.normalizeAllVectors();
                logger.info(`Loaded vector buffer: ${this.vectors.length} floats.`);
            } catch (e) {
                logger.error("Failed to load vectors.bin", e);
                this.vectors = new Float32Array(0);
            }
        }

        // 3. Rebuild Reverse Index
        this.rebuildReverseIndex();
    }

    private resetIndex() {
        this.index = {
            version: 1,
            embeddingModel: this.embeddingService.modelName,
            dimensions: this.embeddingService.dimensions,
            files: {}
        };
        this.vectors = new Float32Array(0);
        this.vectorIdToPath = [];
    }

    private rebuildReverseIndex() {
        const dims = this.index.dimensions;
        const numVectors = dims > 0 ? Math.floor(this.vectors.length / dims) : 0;
        this.vectorIdToPath = new Array<string>(numVectors).fill("");

        for (const path in this.index.files) {
            const entry = this.index.files[path];
            if (entry && entry.ids) {
                for (const id of entry.ids) {
                    if (id < numVectors) {
                        this.vectorIdToPath[id] = path;
                    }
                }
            }
        }
    }

    private normalizeAllVectors() {
        const dims = this.index.dimensions;
        // Check alignment
        if (this.vectors.length % dims !== 0) {
            logger.warn("Vector buffer size alignment error. Truncating.");
            const alignedSize = Math.floor(this.vectors.length / dims) * dims;
            this.vectors = this.vectors.subarray(0, alignedSize);
        }

        const count = this.vectors.length / dims;
        for (let i = 0; i < count; i++) {
            const start = i * dims;
            this.normalizeInPlace(this.vectors.subarray(start, start + dims));
        }
    }

    private normalizeInPlace(vec: Float32Array | number[]) {
        let mag = 0;
        for (let i = 0; i < vec.length; i++) mag += vec[i]! * vec[i]!;
        if (mag === 0 || Math.abs(mag - 1) < 1e-6) return;
        const invMag = 1 / Math.sqrt(mag);
        for (let i = 0; i < vec.length; i++) vec[i]! *= invMag;
    }

    public async saveVectors(immediate = false) {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        const doSave = async () => {
            try {
                await this.ensureDataDir();
                const indexPath = this.getDataPath(INDEX_FILE);
                const vectorsPath = this.getDataPath(VECTORS_FILE);

                // No logic to shrink vectors here beyond relying on deletes to maintain compactness

                await this.plugin.app.vault.adapter.write(indexPath, JSON.stringify(this.index, null, 2));
                await this.plugin.app.vault.adapter.writeBinary(vectorsPath, this.vectors.buffer as ArrayBuffer);

                this.isDirty = false;
                logger.debug("Vectors db saved.");
            } catch (e) {
                logger.error("Failed to save vectors", e);
            }
        };

        if (immediate) {
            await doSave();
        } else {
            this.isDirty = true;
            this.saveDebounceTimer = setTimeout(() => {
                this.saveDebounceTimer = null;
                void doSave();
            }, 2000);
            this.activeTimers.add(this.saveDebounceTimer);
        }
    }

    public scanVault(fullScan = false) {
        if (!this.gemini.isReady()) {
            logger.warn("Gemini Service not ready. Skipping vault scan.");
            return;
        }

        // Automatic re-index if dimensions changed mid-session
        const serviceDims = this.embeddingService.dimensions;
        if (this.index.dimensions > 0 && this.index.dimensions !== serviceDims) {
            logger.warn(`Dimension mismatch detected during scan (${this.index.dimensions} vs ${serviceDims}). Re-indexing...`);
            void this.reindexVault();
            return;
        }

        logger.info("Starting vault scan...");
        const files = this.plugin.app.vault.getMarkdownFiles();
        let changedCount = 0;

        const currentPaths = new Set(files.map(f => f.path));
        const pathsToDelete = Object.keys(this.index.files).filter(p => !currentPaths.has(p));

        for (const p of pathsToDelete) {
            this.deleteVector(p);
            changedCount++;
        }

        for (const file of files) {
            const entry = this.index.files[file.path];
            const isNew = !entry;
            const isModified = entry && entry.mtime !== file.stat.mtime;

            if (fullScan || isNew || isModified) {
                this.enqueueIndex(file);
                changedCount++;
            }
        }

        if (changedCount > 0) {
            logger.info(`Found ${changedCount} files to update/remove.`);
            new Notice(`Vault intelligence: updating ${changedCount} files`);
        } else {
            logger.info("Vault scan complete. No changes.");
        }
    }

    public async reindexVault() {
        logger.info("Re-indexing vault...");
        new Notice("Vault intelligence: re-indexing vault for new model");

        this.isReindexing = true;
        this.requestQueue = []; // Clear pending requests for old model

        this.resetIndex();
        await this.saveVectors(); // Wipe disk
        this.scanVault(true);

        this.isReindexing = false;
    }

    private enqueueIndex(file: TFile) {
        this.requestQueue.push(async () => {
            await this.indexFileImmediate(file);
        });
        void this.processQueue();
    }

    private async processQueue() {
        if (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) return;
        if (this.requestQueue.length === 0) return;
        if (this.isBackingOff) return;

        if (this.consecutiveErrors >= this.MAX_ERRORS_BEFORE_BACKOFF) {
            logger.error(`[VectorStore] Too many consecutive errors. Backing off.`);
            this.triggerBackoff();
            return;
        }

        this.activeRequests++;
        const task = this.requestQueue.shift();

        if (task) {
            try {
                await task();
                this.consecutiveErrors = 0;
                if (this.currentDelayMs > this.baseDelayMs) {
                    this.currentDelayMs = Math.max(this.baseDelayMs, this.currentDelayMs - 1000);
                }
            } catch (e) {
                this.consecutiveErrors++;
                logger.error("Error processing queue task", e);
            } finally {
                this.activeRequests--;
                const timer = setTimeout(() => {
                    this.activeTimers.delete(timer);
                    void this.processQueue();
                }, this.currentDelayMs);
                this.activeTimers.add(timer);
            }
        }
    }

    public indexFile(file: TFile) {
        this.enqueueIndex(file);
    }

    private async indexFileImmediate(file: TFile) {
        if (!file || file.extension !== 'md') return;
        if (!this.gemini.isReady()) return;

        // Double check against existing to avoid duplicate work if queued multiple times
        const entry = this.index.files[file.path];
        if (entry && entry.mtime === file.stat.mtime) return;

        try {
            const content = await this.plugin.app.vault.read(file);
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            let textToEmbed = content;

            // Simple frontmatter removal / title extraction
            if (cache && cache.frontmatter && cache.frontmatterPosition) {
                const { end } = cache.frontmatterPosition;
                const body = content.substring(end.offset).trim();
                let displayTitle = (cache.frontmatter.title as string | undefined) || file.basename;
                if (Array.isArray(displayTitle)) displayTitle = (displayTitle as string[]).join(" ");

                textToEmbed = `Title: ${displayTitle}\n\n${body}`;
            } else {
                textToEmbed = `Title: ${file.basename}\n\n${content}`;
            }

            if (!textToEmbed.trim()) {
                this.deleteVector(file.path); // Just remove if empty
                return;
            }

            logger.info(`Indexing: ${file.path}`);

            // Embed Document now returns number[][]
            const embeddings = await this.embeddingService.embedDocument(textToEmbed, file.basename);

            this.upsertVector(file.path, file.stat.mtime, embeddings);
            void this.saveVectors();

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('429')) {
                logger.warn(`Hit 429 for ${file.path}. Backoff.`);
                this.triggerBackoff();
                this.requestQueue.unshift(async () => this.indexFileImmediate(file));
            } else {
                logger.error(`Failed to index file "${file.path}": ${message}`);
            }
            throw e;
        }
    }

    private upsertVector(path: string, mtime: number, newVectors: number[][]) {
        if (newVectors.length === 0) return;

        const dims = this.index.dimensions;
        if (newVectors[0]!.length !== dims) {
            if (!this.isReindexing) {
                logger.error(`Dimension mismatch! Expected ${dims}, got ${newVectors[0]!.length}. Model in index: ${this.index.embeddingModel}. Current service model: ${this.embeddingService.modelName}`);
            }
            return;
        }

        // 1. Remove existing vectors for this file (always replace logic)
        // This keeps logic simple and avoids fragmentation within a file's chunks
        this.deleteVector(path);

        // 2. Normalize and Append
        newVectors.forEach(v => this.normalizeInPlace(v));

        const startId = this.vectors.length / dims;
        const newIds: number[] = [];

        const totalNewFloats = newVectors.length * dims;

        // Ensure buffer space
        const requiredSize = this.vectors.length + totalNewFloats;
        if (this.vectors.length < requiredSize) {
            // Grow strategy: specific or doubling? specific avoids waste
            // const newSize = requiredSize * 1.5; // Optional buffer
            const newBuffer = new Float32Array(requiredSize);
            newBuffer.set(this.vectors);
            this.vectors = newBuffer;
        }

        for (let i = 0; i < newVectors.length; i++) {
            const vec = newVectors[i]!;
            this.vectors.set(vec, (startId + i) * dims);
            newIds.push(startId + i);
            // Reverse index update
            this.vectorIdToPath[startId + i] = path;
        }

        // 3. Update Index Entry
        this.index.files[path] = {
            ids: newIds,
            mtime: mtime,
            path: path
        };
        this.isDirty = true;
    }

    public deleteVector(path: string) {
        const entry = this.index.files[path];
        if (!entry) return;

        // Assuming IDs are typically contiguous because of upsertVector approach,
        // but robustly handle if they aren't (one by one deletion from end).
        // Sorting IDs descending is critical to not invalidate indices of earlier removals in same batch operation...
        // BUT, a standard splice affects everything after it.

        // OPTIMIZED BATCH REMOVAL for Contiguous Block (Common case)
        const ids = entry.ids.sort((a, b) => a - b);

        const isContiguous = ids.length > 0 &&
            (ids[ids.length - 1]! - ids[0]! + 1 === ids.length);

        if (isContiguous && ids.length > 0) {
            const startId = ids[0]!;
            const count = ids.length;
            const dims = this.index.dimensions;

            // 1. Remove form vectors buffer
            const removeStart = startId * dims;
            const removeEnd = (startId + count) * dims;
            const lengthToRemove = removeEnd - removeStart;

            // Manual partial shift is possibly faster/cleaner than creating new float32array every time?
            // But creating new view is safer.
            // Actually, we can just copy the tail over.
            if (removeEnd < this.vectors.length) {
                this.vectors.copyWithin(removeStart, removeEnd);
            }
            // Truncate
            this.vectors = this.vectors.subarray(0, this.vectors.length - lengthToRemove);

            // 2. Remove from reverse index
            this.vectorIdToPath.splice(startId, count);

            // 3. Update all other IDs
            // Since we removed `count` items at `startId`, all IDs >= `startId + count` (initially) shift down by `count`.
            // With reverse index, we can iterate files or just reverse index?
            // We need to update `index.files` entries. iterating entries is safest.
            for (const key in this.index.files) {
                const f = this.index.files[key]!;
                // Mutate the array
                for (let i = 0; i < f.ids.length; i++) {
                    if (f.ids[i]! > startId) {
                        f.ids[i]! -= count;
                    }
                }
            }
        } else {
            // Fallback: Delete one by one backwards
            // If we delete largest ID first, it doesn't affect smaller IDs?
            // Deleting ID 100 shifts 101+. ID 50 is unaffected.
            // So iterating descending is correct.
            for (let i = ids.length - 1; i >= 0; i--) {
                this.deleteSingleId(ids[i]!);
            }
        }

        delete this.index.files[path];
        this.isDirty = true;
    }

    private deleteSingleId(id: number) {
        const dims = this.index.dimensions;
        const removeStart = id * dims;
        const removeEnd = removeStart + dims;

        if (removeEnd < this.vectors.length) {
            this.vectors.copyWithin(removeStart, removeEnd);
        }
        this.vectors = this.vectors.subarray(0, this.vectors.length - dims);
        this.vectorIdToPath.splice(id, 1);

        for (const key in this.index.files) {
            const f = this.index.files[key]!;
            for (let k = 0; k < f.ids.length; k++) {
                if (f.ids[k]! > id) f.ids[k]!--;
            }
        }
    }

    public async renameVector(oldPath: string, newPath: string) {
        const entry = this.index.files[oldPath];
        if (!entry) return;

        logger.info(`Renaming vector from ${oldPath} to ${newPath}`);
        this.index.files[newPath] = { ...entry, path: newPath };
        delete this.index.files[oldPath];

        // Update reverse index
        entry.ids.forEach(id => {
            this.vectorIdToPath[id] = newPath;
        });

        await this.saveVectors();
    }

    private triggerBackoff() {
        if (this.isBackingOff) return;
        this.isBackingOff = true;
        this.currentDelayMs = 30000;

        const timer = setTimeout(() => {
            this.activeTimers.delete(timer);
            this.isBackingOff = false;
            logger.info("Resuming queue after backoff.");
            void this.processQueue();
        }, 60000);
        this.activeTimers.add(timer);
    }

    public destroy() {
        if (this.isDirty || this.saveDebounceTimer) {
            if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
            void this.saveVectors(true);
        }
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers.clear();
        this.requestQueue = [];
        this.activeRequests = 0;
        this.isBackingOff = true;
    }

    public getVector(path: string): number[] | null {
        // Return first vector for debugging/compatibility? 
        // Or change signature? Use case: getting vector for similarity?
        // Usually we don't retrieve single file vector externally. SImilarity uses internal buffer.
        const entry = this.index.files[path];
        if (!entry || entry.ids.length === 0) return null;

        const id = entry.ids[0]!;
        const start = id * this.index.dimensions;
        return Array.from(this.vectors.slice(start, start + this.index.dimensions));
    }

    public findSimilar(queryVector: number[], limit?: number, threshold?: number, excludePath?: string): { path: string; score: number }[] {
        const query = new Float32Array(queryVector);
        this.normalizeInPlace(query);

        const minScore = threshold ?? this.minSimilarityScore;
        const finalLimit = limit ?? this.similarNotesLimit;
        const count = this.vectors.length / this.index.dimensions;

        const scores: { path: string, score: number }[] = [];
        // Track best score per path to support multi-vector matches (MaxSim)
        const bestScoreByPath = new Map<string, number>();

        for (let i = 0; i < count; i++) {
            const start = i * this.index.dimensions;
            const vec = this.vectors.subarray(start, start + this.index.dimensions);
            const score = this.dotProduct(query, vec);

            if (score >= minScore) {
                // Optimize: usage of reverse index
                const path = this.vectorIdToPath[i];
                if (path && path !== excludePath) {
                    const existing = bestScoreByPath.get(path) ?? -1;
                    if (score > existing) {
                        bestScoreByPath.set(path, score);
                    }
                }
            }
        }

        // Convert Map to Array
        for (const [path, score] of bestScoreByPath.entries()) {
            scores.push({ path, score });
        }

        scores.sort((a, b) => b.score - a.score);

        return (finalLimit > 0) ? scores.slice(0, finalLimit) : scores;
    }

    private dotProduct(a: Float32Array, b: Float32Array): number {
        let dot = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            const val = a[i]! * b[i]!;
            if (!isNaN(val)) dot += val;
        }
        return dot;
    }
}