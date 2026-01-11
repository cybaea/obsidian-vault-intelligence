import { TFile, Notice, Plugin, normalizePath } from "obsidian";
import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";
import { GeminiService } from "./GeminiService";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings";
import { EMBEDDING_CONSTANTS } from "../constants";

const DATA_DIR = "data";
const INDEX_FILE = "index.json";
const VECTORS_FILE = "vectors.bin";

interface VectorEntry {
    ids: number[];
    mtime: number;
    size: number;
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
    private pendingIndexTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();
    private settings: VaultIntelligenceSettings;
    private consecutiveErrors = 0;

    // Data Store
    private index: VectorIndex;
    private vectors: Float32Array = new Float32Array(0);
    private vectorIdToPath: string[] = [];

    // Concurrency Control
    private requestQueue: (() => Promise<void>)[] = [];
    private activeRequests = 0;
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

        this.updateSettings(settings);
    }

    public setEmbeddingService(service: IEmbeddingService) {
        this.embeddingService = service;
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.baseDelayMs = settings.queueDelayMs || EMBEDDING_CONSTANTS.DEFAULT_QUEUE_DELAY_MS;
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

        if (await this.plugin.app.vault.adapter.exists(indexPath)) {
            try {
                const indexStr = await this.plugin.app.vault.adapter.read(indexPath);
                const loadedRaw = JSON.parse(indexStr) as Record<string, unknown>;

                // Compatibility Update
                const files = loadedRaw.files as Record<string, Record<string, unknown>> | undefined;
                if (files && typeof files === 'object') {
                    for (const key in files) {
                        const entry = files[key] as Record<string, unknown>;
                        if (entry && 'id' in entry && !('ids' in entry)) {
                            entry.ids = [entry.id];
                            delete entry.id;
                        }
                        if (entry && !('size' in entry)) {
                            entry.size = 0; // Default for old indices
                        }
                    }
                }
                this.index = loadedRaw as unknown as VectorIndex;

                const modelChanged = this.index.embeddingModel !== this.embeddingService.modelName;
                const dimChanged = this.index.dimensions !== this.embeddingService.dimensions;

                if (modelChanged || dimChanged) {
                    logger.warn(`${modelChanged ? "Model" : "Dimension"} changed. Wiping index.`);
                    await this.reindexVault();
                    return;
                }
                logger.info(`Loaded index for ${Object.keys(this.index.files).length} files.`);
            } catch (e) {
                logger.error("Failed to load index.json", e);
                this.resetIndex();
            }
        }

        if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
            try {
                const buffer = await this.plugin.app.vault.adapter.readBinary(vectorsPath);
                const dims = this.index.dimensions;
                const count = Object.values(this.index.files).reduce((acc, f) => acc + f.ids.length, 0);
                const expectedFloats = count * dims;

                const rawVectors = new Float32Array(buffer);
                this.vectors = rawVectors.length > expectedFloats && expectedFloats > 0
                    ? rawVectors.slice(0, expectedFloats)
                    : rawVectors;

                this.normalizeAllVectors();
                logger.info(`Loaded vector buffer: ${this.vectors.length} floats.`);
            } catch (e) {
                logger.error("Failed to load vectors.bin", e);
                this.vectors = new Float32Array(0);
            }
        }

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
            if (entry) {
                for (const id of entry.ids) {
                    if (id < numVectors) this.vectorIdToPath[id] = path;
                }
            }
        }
    }

    private normalizeAllVectors() {
        const dims = this.index.dimensions;
        if (this.vectors.length % dims !== 0) {
            this.vectors = this.vectors.subarray(0, Math.floor(this.vectors.length / dims) * dims);
        }
        for (let i = 0; i < this.vectors.length / dims; i++) {
            this.normalizeInPlace(this.vectors.subarray(i * dims, (i + 1) * dims));
        }
    }

    private normalizeInPlace(vec: Float32Array | number[]) {
        let mag = 0;
        for (let i = 0; i < vec.length; i++) mag += vec[i]! * vec[i]!;
        if (mag === 0 || Math.abs(mag - 1) < EMBEDDING_CONSTANTS.NORMALIZATION_PRECISION) return;
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
                const count = this.vectorIdToPath.length;
                const dims = this.index.dimensions;
                const activeData = this.vectors.slice(0, count * dims);

                await this.plugin.app.vault.adapter.write(indexPath, JSON.stringify(this.index, null, 2));
                await this.plugin.app.vault.adapter.writeBinary(vectorsPath, activeData.buffer);

                this.isDirty = false;
                logger.debug("Vectors db saved.");
            } catch (e) {
                logger.error("Failed to save vectors", e);
            }
        };

        if (immediate) await doSave();
        else {
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
            logger.warn("Gemini Service not ready. Skipping scan.");
            return;
        }

        const serviceDims = this.embeddingService.dimensions;
        if (this.index.dimensions > 0 && this.index.dimensions !== serviceDims) {
            logger.warn("Dimension mismatch. Re-indexing...");
            void this.reindexVault();
            return;
        }

        logger.info("Scanning vault...");
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
            const isModified = !entry || entry.mtime !== file.stat.mtime || entry.size !== file.stat.size;

            if (fullScan || isModified) {
                this.enqueueIndex(file);
                changedCount++;
            }
        }

        if (changedCount > 0) {
            logger.info(`Found ${changedCount} files to update/remove.`);
            new Notice(`Vault intelligence: updating ${changedCount} files`);
        }
    }

    public async reindexVault() {
        this.isReindexing = true;
        this.requestQueue = [];
        this.resetIndex();
        await this.saveVectors(true);
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
        if (this.activeRequests >= EMBEDDING_CONSTANTS.MAX_CONCURRENT_REQUESTS || this.requestQueue.length === 0 || this.isBackingOff) return;

        if (this.consecutiveErrors >= EMBEDDING_CONSTANTS.MAX_ERRORS_BEFORE_BACKOFF) {
            logger.error(`Too many errors. Backing off.`);
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
                logger.error(`Queue error (${this.consecutiveErrors}/${EMBEDDING_CONSTANTS.MAX_ERRORS_BEFORE_BACKOFF}):`, e);
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

    public async getOrIndexFile(file: TFile): Promise<number[] | null> {
        const vector = this.getVector(file.path);
        if (vector) return vector;
        const embeddings = await this.indexFileImmediate(file, 'high');
        return embeddings && embeddings.length > 0 ? embeddings[0]! : null;
    }

    public requestIndex(file: TFile, delayMs?: number) {
        if (!file || file.extension !== 'md') return;

        const existingTimer = this.pendingIndexTimers.get(file.path);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.activeTimers.delete(existingTimer);
        }

        const waitTime = delayMs ?? this.settings.indexingDelayMs ?? EMBEDDING_CONSTANTS.DEFAULT_INDEXING_DELAY_MS;

        const timer = setTimeout(() => {
            this.pendingIndexTimers.delete(file.path);
            this.activeTimers.delete(timer);
            this.enqueueIndex(file);
        }, waitTime);

        this.pendingIndexTimers.set(file.path, timer);
        this.activeTimers.add(timer);
    }

    private async indexFileImmediate(file: TFile, priority: EmbeddingPriority = 'low'): Promise<number[][] | null> {
        if (!file || file.extension !== 'md') return null;

        const entry = this.index.files[file.path];
        if (entry && entry.mtime === file.stat.mtime && entry.size === file.stat.size) {
            const dims = this.index.dimensions;
            return entry.ids.map(id => Array.from(this.vectors.slice(id * dims, (id + 1) * dims)));
        }

        try {
            const content = await this.plugin.app.vault.read(file);
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            let textToEmbed = content;

            if (cache?.frontmatter && cache.frontmatterPosition) {
                const body = content.substring(cache.frontmatterPosition.end.offset).trim();
                let title = (cache.frontmatter.title as unknown) || file.basename;
                if (Array.isArray(title)) title = (title as string[]).join(" ");
                textToEmbed = `Title: ${title as string}\n\n${body}`;
            } else {
                textToEmbed = `Title: ${file.basename}\n\n${content}`;
            }

            if (!textToEmbed.trim()) {
                this.deleteVector(file.path);
                return null;
            }

            logger.info(`[${this.embeddingService.modelName}/${this.embeddingService.dimensions}] Indexing: ${file.path}`);
            const embeddings = await this.embeddingService.embedDocument(textToEmbed, file.basename, priority);

            this.upsertVector(file.path, file.stat.mtime, file.stat.size, embeddings);
            void this.saveVectors();
            return embeddings;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('429') || (typeof e === 'object' && e !== null && 'status' in e && (e as Record<string, unknown>).status === 429)) {
                logger.warn(`Hit 429 for ${file.path}. Backoff.`);
                this.triggerBackoff();
                this.requestQueue.unshift(async () => {
                    await this.indexFileImmediate(file, priority);
                });
            } else {
                logger.error(`Failed to index "${file.path}": ${message}`, e);
            }
            throw e;
        }
    }

    private upsertVector(path: string, mtime: number, size: number, newVectors: number[][]) {
        if (newVectors.length === 0) return;
        const dims = this.index.dimensions;
        this.deleteVector(path);
        newVectors.forEach(v => this.normalizeInPlace(v));

        const startId = this.vectorIdToPath.length;
        const newIds: number[] = [];
        const requiredSize = (startId + newVectors.length) * dims;

        if (this.vectors.length < requiredSize) {
            const newBuffer = new Float32Array(Math.ceil(requiredSize * 1.5));
            newBuffer.set(this.vectors.subarray(0, startId * dims));
            this.vectors = newBuffer;
        }

        for (let i = 0; i < newVectors.length; i++) {
            this.vectors.set(newVectors[i]!, (startId + i) * dims);
            newIds.push(startId + i);
            this.vectorIdToPath[startId + i] = path;
        }

        this.index.files[path] = { ids: newIds, mtime, size, path };
        this.isDirty = true;
    }

    public deleteVector(path: string) {
        const entry = this.index.files[path];
        if (!entry) return;

        const ids = entry.ids.sort((a, b) => b - a);
        for (const id of ids) {
            const dims = this.index.dimensions;
            if ((id + 1) * dims < this.vectors.length) {
                this.vectors.copyWithin(id * dims, (id + 1) * dims);
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

        delete this.index.files[path];
        this.isDirty = true;
    }

    public async renameVector(oldPath: string, newPath: string) {
        const entry = this.index.files[oldPath];
        if (!entry) return;
        this.index.files[newPath] = { ...entry, path: newPath };
        delete this.index.files[oldPath];
        entry.ids.forEach(id => this.vectorIdToPath[id] = newPath);
        await this.saveVectors();
    }

    private triggerBackoff() {
        if (this.isBackingOff) return;
        this.isBackingOff = true;
        this.currentDelayMs = EMBEDDING_CONSTANTS.BACKOFF_DELAY_MS;
        const timer = setTimeout(() => {
            this.activeTimers.delete(timer);
            this.isBackingOff = false;
            logger.info("Resuming queue after backoff.");
            void this.processQueue();
        }, EMBEDDING_CONSTANTS.RESUME_TIMEOUT_MS);
        this.activeTimers.add(timer);
    }

    public destroy() {
        if (this.isDirty || this.saveDebounceTimer) {
            if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
            void this.saveVectors(true);
        }
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers.clear();
        this.pendingIndexTimers.clear();
        this.requestQueue = [];
        this.activeRequests = 0;
        this.isBackingOff = true;
    }

    public getVector(path: string): number[] | null {
        const entry = this.index.files[path];
        if (!entry || entry.ids.length === 0) return null;
        const start = entry.ids[0]! * this.index.dimensions;
        return Array.from(this.vectors.slice(start, start + this.index.dimensions));
    }

    public findSimilar(queryVector: number[], limit?: number, threshold?: number, excludePath?: string): { path: string; score: number }[] {
        const query = new Float32Array(queryVector);
        this.normalizeInPlace(query);

        const minScore = threshold ?? this.minSimilarityScore;
        const finalLimit = limit ?? this.similarNotesLimit;
        const bestScoreByPath = new Map<string, number>();
        const dims = this.index.dimensions;

        for (let i = 0; i < this.vectorIdToPath.length; i++) {
            let score = 0;
            const start = i * dims;
            for (let j = 0; j < dims; j++) score += query[j]! * this.vectors[start + j]!;

            if (score >= minScore) {
                const path = this.vectorIdToPath[i];
                if (path && path !== excludePath) {
                    bestScoreByPath.set(path, Math.max(bestScoreByPath.get(path) ?? -1, score));
                }
            }
        }

        const scores = Array.from(bestScoreByPath.entries()).map(([path, score]) => ({ path, score }));
        scores.sort((a, b) => b.score - a.score);
        return finalLimit > 0 ? scores.slice(0, finalLimit) : scores;
    }
}