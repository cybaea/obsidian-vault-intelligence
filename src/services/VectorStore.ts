import { TFile, Notice, Plugin, normalizePath } from "obsidian";
import { IEmbeddingService } from "./IEmbeddingService";
import { GeminiService } from "./GeminiService";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings";

const DATA_DIR = "data";
const INDEX_FILE = "index.json";
const VECTORS_FILE = "vectors.bin";

interface VectorEntry {
    id: number;
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
    private consecutiveErrors = 0; // Circuit breaker
    private readonly MAX_ERRORS_BEFORE_BACKOFF = 5;

    // Data Store
    private index: VectorIndex; 
    private vectors: Float32Array = new Float32Array(0);

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

    constructor(plugin: Plugin, gemini: GeminiService, embeddingService: IEmbeddingService, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.gemini = gemini; 
        this.embeddingService = embeddingService; // Injected
        this.settings = settings;
        
        this.index = {
            version: 1,
            // CHANGE: Use service property instead of settings directly/gemini getter
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
                this.index = JSON.parse(indexStr) as VectorIndex;

                const modelChanged = this.index.embeddingModel !== this.embeddingService.modelName;
                const dimChanged = this.index.dimensions !== this.embeddingService.dimensions;

                if (modelChanged || dimChanged) {
                    const reason = modelChanged ? "Model changed" : "Dimension changed";
                    logger.warn(`${reason}. Wiping index to rebuild.`);
                    
                    this.index = {
                        version: 1,
                        // CHANGE: Use embeddingService
                        embeddingModel: this.embeddingService.modelName,
                        dimensions: this.embeddingService.dimensions,
                        files: {}
                    };
                    this.vectors = new Float32Array(0);
                    if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
                        await this.plugin.app.vault.adapter.remove(vectorsPath);
                    }
                    await this.saveVectors(true);
                    return;
                }
                logger.info(`Loaded index for ${Object.keys(this.index.files).length} files.`);
            } catch (e) {
                logger.error("Failed to load index.json", e);
                // CHANGE: Fallback initialization now uses embeddingService
                this.index = { 
                    version: 1, 
                    embeddingModel: this.embeddingService.modelName, 
                    dimensions: this.embeddingService.dimensions, 
                    files: {} 
                };
            }
        }

        // 2. Load Binary Vectors
        if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
            try {
                const buffer = await this.plugin.app.vault.adapter.readBinary(vectorsPath);
                this.vectors = new Float32Array(buffer);
                
                // OPTIMIZATION: Normalize all loaded vectors immediately.
                // This migrates old data to the new unit-vector standard.
                this.normalizeAllVectors();
                
                logger.info(`Loaded vector buffer: ${this.vectors.length} floats.`);
            } catch (e) {
                logger.error("Failed to load vectors.bin", e);
                this.vectors = new Float32Array(0);
            }
        }
    }

    // Helper to normalize the entire buffer in-place
    private normalizeAllVectors() {
        const dims = this.index.dimensions;
        const count = this.vectors.length / dims;
        
        for (let i = 0; i < count; i++) {
            const start = i * dims;
            const end = start + dims;
            const vec = this.vectors.subarray(start, end);
            this.normalizeInPlace(vec);
        }
    }

    // Helper to normalize a single vector (modifies input)
    private normalizeInPlace(vec: Float32Array | number[]) {
        let mag = 0;
        for (let i = 0; i < vec.length; i++) {
            // FIX: Assert existence with !
            const val = vec[i]!;
            mag += val * val;
        }
        if (mag === 0 || Math.abs(mag - 1) < 1e-6) return; // Already normalized or zero

        const invMag = 1 / Math.sqrt(mag);
        for (let i = 0; i < vec.length; i++) {
            // FIX: Assert existence with ! and assign explicitly
            vec[i] = vec[i]! * invMag;
        }
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

    public async scanVault(fullScan = false) {
        if (!this.gemini.isReady()) {
            logger.warn("Gemini Service not ready. Skipping vault scan.");
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
                if (isNew) {
                    logger.info(`[Scan] Queuing NEW file: "${file.path}"`);
                } else if (isModified) {
                    logger.info(`[Scan] Queuing MODIFIED file: "${file.path}"`);
                }
                
                this.enqueueIndex(file);
                changedCount++;
            }
        }

        if (changedCount > 0) {
            logger.info(`Found ${changedCount} files to update/remove.`);
            new Notice(`Vault Intelligence: Updating ${changedCount} files...`);
            if (pathsToDelete.length > 0) await this.saveVectors();
        } else {
            logger.info("Vault scan complete. No changes.");
        }
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

        // NEW: Check circuit breaker
        if (this.consecutiveErrors >= this.MAX_ERRORS_BEFORE_BACKOFF) {
            logger.error(`[VectorStore] Too many consecutive errors (${this.consecutiveErrors}). Pausing queue for 1 minute.`);
            this.triggerBackoff();
            return;
        }

        this.activeRequests++;
        const task = this.requestQueue.shift();

        if (task) {
            try {
                await task();
                // Success! Reset breaker.
                this.consecutiveErrors = 0; 
                if (this.currentDelayMs > this.baseDelayMs) {
                    this.currentDelayMs = Math.max(this.baseDelayMs, this.currentDelayMs - 1000);
                }
            } catch (e) {
                // Failure! Increment breaker.
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

    // In src/services/VectorStore.ts

    private async indexFileImmediate(file: TFile) {
        if (!file || file.extension !== 'md') return;

        if (!this.gemini.isReady()) return;

        const entry = this.index.files[file.path];
        if (entry && entry.mtime === file.stat.mtime) return;

        try {
            const content = await this.plugin.app.vault.read(file);
            
            // 1. Get Metadata to optimize the embedding input
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            let textToEmbed = content;

            if (cache && cache.frontmatter) {
                // Remove the raw YAML block from the body
                if (cache.frontmatterPosition) {
                    const { end } = cache.frontmatterPosition;
                    const body = content.substring(end.offset).trim();
                    
                    // 2. Construct Semantic Header
                    // PREFERENCE: Use YAML title if available, else filename
                    let displayTitle = file.basename;
                    if (cache.frontmatter.title && typeof cache.frontmatter.title === 'string') {
                        displayTitle = cache.frontmatter.title;
                    }

                    const titleLine = `Title: ${displayTitle}`;
                    let metaString = titleLine;

                    // Boost Aliases
                    if (cache.frontmatter.aliases) {
                        // FIX: Explicitly cast 'any' to string | string[]
                        const rawAliases = cache.frontmatter.aliases as string | string[];
                        const aliases = Array.isArray(rawAliases) 
                            ? rawAliases.join(", ") 
                            : rawAliases;
                        metaString += `\nAliases: ${aliases}`;
                    }

                    // Boost Tags
                    if (cache.frontmatter.tags) {
                        // FIX: Explicitly cast 'any' to string | string[]
                        const rawTags = cache.frontmatter.tags as string | string[];
                        const tags = Array.isArray(rawTags) 
                            ? rawTags.join(", ") 
                            : rawTags;
                        metaString += `\nTags: ${tags}`;
                    }

                    // Combine: Optimized Header + Clean Body
                    textToEmbed = `${metaString}\n\n${body}`;
                }
            } else {
                // No YAML? Just prepend the filename
                textToEmbed = `Title: ${file.basename}\n\n${content}`;
            }

            if (!textToEmbed.trim()) {
                logger.debug(`[Index] File effectively empty: "${file.path}". Marking as indexed (zero-vector).`);
                const zeroEmbedding = new Array<number>(this.index.dimensions).fill(0);
                this.upsertVector(file.path, file.stat.mtime, zeroEmbedding);
                void this.saveVectors(); 
                return;
            }

            logger.info(`Indexing: ${file.path}`);

            // Pass the selected title to Gemini for context as well
            const embedding = await this.embeddingService.embedDocument(textToEmbed, file.basename);

            this.upsertVector(file.path, file.stat.mtime, embedding);
            void this.saveVectors(); 

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('429')) {
                logger.warn(`Hit 429 in VectorStore for ${file.path}. Pausing queue.`);
                this.triggerBackoff();
                this.requestQueue.unshift(async () => this.indexFileImmediate(file));
            } else {
                logger.error(`Failed to index file "${file.path}": ${message}`);
            }
            throw e;
        }
    }

    private upsertVector(path: string, mtime: number, embedding: number[]) {
        if (embedding.length !== this.index.dimensions) {
            logger.error(`Dimension mismatch! Expected ${this.index.dimensions}, got ${embedding.length}`);
            return;
        }

        // OPTIMIZATION: Normalize BEFORE storing.
        // This ensures the vector has magnitude 1.0
        this.normalizeInPlace(embedding);

        let entry = this.index.files[path];

        if (entry) {
            const start = entry.id * this.index.dimensions;
            this.vectors.set(embedding, start);
            entry.mtime = mtime; 
        } else {
            const currentCount = this.vectors.length / this.index.dimensions;
            const newVectors = new Float32Array(this.vectors.length + this.index.dimensions);
            newVectors.set(this.vectors);
            newVectors.set(embedding, this.vectors.length);
            this.vectors = newVectors;

            this.index.files[path] = {
                id: currentCount,
                mtime: mtime,
                path: path
            };
        }
        this.isDirty = true;
    }

    public deleteVector(path: string) {
        const entry = this.index.files[path];
        if (!entry) return;

        const idToRemove = entry.id;

        delete this.index.files[path];
        this.isDirty = true;

        const newVectors = new Float32Array(this.vectors.length - this.index.dimensions);
        
        if (idToRemove > 0) {
            newVectors.set(this.vectors.subarray(0, idToRemove * this.index.dimensions), 0);
        }
        
        const afterStart = (idToRemove + 1) * this.index.dimensions;
        if (afterStart < this.vectors.length) {
            newVectors.set(this.vectors.subarray(afterStart), idToRemove * this.index.dimensions);
        }
        this.vectors = newVectors;

        for (const key in this.index.files) {
            const f = this.index.files[key];
            if (f && f.id > idToRemove) {
                f.id--;
            }
        }
    }

    public async renameVector(oldPath: string, newPath: string) {
        const entry = this.index.files[oldPath];
        if (!entry) return;

        logger.info(`Renaming vector from ${oldPath} to ${newPath}`);
        this.index.files[newPath] = { ...entry, path: newPath };
        delete this.index.files[oldPath];
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
            logger.info("Plugin unloading: Saving pending vector updates...");
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
        const entry = this.index.files[path];
        if (!entry) return null;

        const start = entry.id * this.index.dimensions;
        const end = start + this.index.dimensions;
        return Array.from(this.vectors.slice(start, end));
    }

    public findSimilar(queryVector: number[], limit?: number, threshold?: number, excludePath?: string): { path: string; score: number }[] {
        // OPTIMIZATION: Normalize query vector ONCE.
        // We create a Float32Array copy to allow in-place normalization without affecting the caller.
        const query = new Float32Array(queryVector);
        this.normalizeInPlace(query);

        const minScore = threshold ?? this.minSimilarityScore;
        const finalLimit = limit ?? this.similarNotesLimit;

        const count = this.vectors.length / this.index.dimensions;
        logger.info(`Searching ${count} vectors. Threshold: ${minScore}, Limit: ${finalLimit}`);

        const scores: { path: string, score: number }[] = [];

        for (let i = 0; i < count; i++) {
            const start = i * this.index.dimensions;
            const vec = this.vectors.subarray(start, start + this.index.dimensions);
            
            // OPTIMIZATION: Use fast dot product since both vectors are normalized
            const score = this.dotProduct(query, vec);

            if (score >= minScore) {
                const path = Object.keys(this.index.files).find(p => this.index.files[p]?.id === i);
                if (path && path !== excludePath) {
                    scores.push({ path, score });
                }
            }
        }

        scores.sort((a, b) => b.score - a.score);

        let matches = scores;

        if (finalLimit && finalLimit > 0) {
            matches = matches.slice(0, finalLimit);
        }

        return matches;
    }

    // Replaced slow Cosine Similarity with fast Dot Product
    // This is valid because we guarantee inputs are unit vectors.
    private dotProduct(a: Float32Array, b: Float32Array): number {
        let dot = 0;
        // Manual loop unrolling or just simple loop is fast in V8
        for (let i = 0; i < a.length; i++) {
            // FIX: Assert existence with !
            dot += a[i]! * b[i]!;
        }
        return dot;
    }
}