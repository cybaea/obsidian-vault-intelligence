import { TFile, Notice, Plugin, normalizePath } from "obsidian";
import { TaskType } from "@google/generative-ai";
import { GeminiService } from "./GeminiService";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings";

const DATA_DIR = "data";
const INDEX_FILE = "index.json";
const VECTORS_FILE = "vectors.bin";
const EMBEDDING_DIMENSION = 768; // Gemini 1.5 Flash/Pro are 768

interface VectorEntry {
    id: number;       // Index in the binary array (row number)
    mtime: number;    // File modification time
    path: string;     // File path
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
    private saveDebounceTimer: NodeJS.Timeout | null = null;

    // Data Store
    private index: VectorIndex = {
        version: 1,
        embeddingModel: "gemini-1.5-flash",
        dimensions: EMBEDDING_DIMENSION,
        files: {}
    };
    private vectors: Float32Array = new Float32Array(0);

    // Concurrency Control
    private requestQueue: (() => Promise<void>)[] = [];
    private activeRequests = 0;
    private readonly MAX_CONCURRENT_REQUESTS = 1;
    private baseDelayMs: number;
    private currentDelayMs: number;
    private minSimilarityScore: number;
    private isBackingOff = false;

    constructor(plugin: Plugin, gemini: GeminiService, settings: VaultIntelligenceSettings) {
        this.plugin = plugin;
        this.gemini = gemini;
        this.baseDelayMs = settings.indexingDelayMs || 200;
        this.currentDelayMs = this.baseDelayMs;
        this.minSimilarityScore = settings.minSimilarityScore ?? 0.5;
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.baseDelayMs = settings.indexingDelayMs || 200;
        this.minSimilarityScore = settings.minSimilarityScore ?? 0.5;
        // If not currently backing off, sync current delay? 
        if (!this.isBackingOff) {
            this.currentDelayMs = this.baseDelayMs;
        }
    }

    private getDataPath(filename: string): string {
        // Use the plugin's data directory inside the vault
        // e.g., .obsidian/plugins/obsidian-vault-intelligence/data/vectors.bin
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
                this.index = JSON.parse(indexStr);

                // Check for Model Mismatch
                if (this.index.embeddingModel !== this.gemini.getEmbeddingModelName()) {
                    logger.warn(`Embedding model changed from ${this.index.embeddingModel} to ${this.gemini.getEmbeddingModelName()}. Wiping index.`);
                    this.index = {
                        version: 1,
                        embeddingModel: this.gemini.getEmbeddingModelName(),
                        dimensions: EMBEDDING_DIMENSION,
                        files: {}
                    };
                    this.vectors = new Float32Array(0);
                    // Delete vectors file if exists to allow fresh start
                    if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
                        await this.plugin.app.vault.adapter.remove(vectorsPath);
                    }
                    await this.saveVectors(true);
                    return; // Done reset
                }

                logger.info(`Loaded index for ${Object.keys(this.index.files).length} files.`);
            } catch (e) {
                logger.error("Failed to load index.json", e);
                // Reset on corrupt index
                this.index = { version: 1, embeddingModel: this.gemini.getEmbeddingModelName(), dimensions: EMBEDDING_DIMENSION, files: {} };
            }
        }

        // 2. Load Binary Vectors
        if (await this.plugin.app.vault.adapter.exists(vectorsPath)) {
            try {
                const buffer = await this.plugin.app.vault.adapter.readBinary(vectorsPath);
                this.vectors = new Float32Array(buffer);
                logger.info(`Loaded vector buffer: ${this.vectors.length} floats.`);
            } catch (e) {
                logger.error("Failed to load vectors.bin", e);
                this.vectors = new Float32Array(0);
            }
        }

        // 3. Simple Consistency Check (Optional)
        const expectedSize = Object.keys(this.index.files).length * this.index.dimensions;
        if (this.vectors.length !== expectedSize) {
            logger.warn(`Vector store inconsistency! Index says ${Object.keys(this.index.files).length} files (${expectedSize} floats), but buffer has ${this.vectors.length}.`);
            // To be safe, we could wipe, but for now just log. 
            // In a real scenario, we might want to rebuild or truncate.
        }
    }

    public async saveVectors(immediate = false) {
        if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);

        const doSave = async () => {
            try {
                await this.ensureDataDir();
                const indexPath = this.getDataPath(INDEX_FILE);
                const vectorsPath = this.getDataPath(VECTORS_FILE);

                await this.plugin.app.vault.adapter.write(indexPath, JSON.stringify(this.index, null, 2));
                await this.plugin.app.vault.adapter.writeBinary(vectorsPath, this.vectors.buffer as ArrayBuffer);

                logger.debug("Vectors db saved (binary + index).");
            } catch (e) {
                logger.error("Failed to save vectors", e);
            }
        };

        if (immediate) {
            await doSave();
        } else {
            this.saveDebounceTimer = setTimeout(doSave, 2000);
        }
    }

    /**
     * Scans the entire vault for files that need indexing.
     */
    public async scanVault(fullScan = false) {
        if (!this.gemini.isReady()) {
            logger.warn("Gemini Service not ready (missing API key?). Skipping vault scan.");
            return;
        }

        logger.info("Starting vault scan...");
        const files = this.plugin.app.vault.getMarkdownFiles();
        let changedCount = 0;

        // Cleanup: Identify deleted files
        const currentPaths = new Set(files.map(f => f.path));
        const pathsToDelete = Object.keys(this.index.files).filter(p => !currentPaths.has(p));

        for (const p of pathsToDelete) {
            this.deleteVector(p);
            changedCount++;
        }

        for (const file of files) {
            const entry = this.index.files[file.path];
            // Check if missing or outdated
            if (fullScan || !entry || entry.mtime !== file.stat.mtime) {
                this.enqueueIndex(file);
                changedCount++;
            }
        }

        if (changedCount > 0) {
            logger.info(`Found ${changedCount} files to update/remove.`);
            new Notice(`Vault Intelligence: Updating ${changedCount} files...`);
            // Explicit save to persist deletions immediately if any
            if (pathsToDelete.length > 0) await this.saveVectors();
        } else {
            logger.info("Vault scan complete. No changes.");
        }
    }

    private enqueueIndex(file: TFile) {
        this.requestQueue.push(async () => {
            await this.indexFileImmediate(file);
        });
        this.processQueue();
    }

    private async processQueue() {
        if (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) return;
        if (this.requestQueue.length === 0) return;
        if (this.isBackingOff) return;

        this.activeRequests++;
        const task = this.requestQueue.shift();

        if (task) {
            try {
                await task();
                // Success: slowly recover delay
                if (this.currentDelayMs > this.baseDelayMs) {
                    this.currentDelayMs = Math.max(this.baseDelayMs, this.currentDelayMs - 1000);
                }
            } catch (e) {
                logger.error("Error processing queue task", e);
            } finally {
                this.activeRequests--;
                setTimeout(() => this.processQueue(), this.currentDelayMs);
            }
        }
    }

    public async indexFile(file: TFile) {
        this.enqueueIndex(file);
    }

    private async indexFileImmediate(file: TFile) {
        if (!file || file.extension !== 'md') return;

        if (!this.gemini.isReady()) {
            logger.debug("Gemini not ready, skipping index: " + file.path);
            return;
        }

        /* 
           Double check mtime to avoid redundant work if queue got backed up 
           (though scanVault checks this, manual saves might not)
        */
        const entry = this.index.files[file.path];
        if (entry && entry.mtime === file.stat.mtime) return;

        try {
            const content = await this.plugin.app.vault.read(file);
            if (!content.trim()) return;

            logger.info(`Indexing: ${file.path}`);

            const embedding = await this.gemini.embedText(content, {
                taskType: TaskType.RETRIEVAL_DOCUMENT,
                title: file.basename
            });

            // Update Store
            this.upsertVector(file.path, file.stat.mtime, embedding);
            await this.saveVectors();

            // logger.info(`Successfully indexed: ${file.path}`);

        } catch (e: any) {
            if (e.message?.includes('429') || e.toString().includes('429')) {
                logger.warn(`Hit 429 in VectorStore for ${file.path}. Pausing queue.`);
                this.triggerBackoff();
                // Re-queue this task at the front? Or just let scan pick it up next time.
                // Let's re-queue it to be nice.
                this.requestQueue.unshift(async () => this.indexFileImmediate(file));
            } else {
                logger.warn(`Failed to index file ${file.path}`, e);
            }
            throw e;
        }
    }

    private upsertVector(path: string, mtime: number, embedding: number[]) {
        if (embedding.length !== this.index.dimensions) {
            logger.error(`Dimension mismatch! Expected ${this.index.dimensions}, got ${embedding.length}`);
            return;
        }

        let entry = this.index.files[path];

        if (entry) {
            // Update existing
            const start = entry.id * this.index.dimensions;
            this.vectors.set(embedding, start);
            entry.mtime = mtime; // update mtime
        } else {
            // Append new
            const newId = Object.keys(this.index.files).length; // Check current count *before* adding this one? 
            // Wait, IDs must be stable or we track them.
            // If we use "compact" IDs 0..N-1, then new ID is always current count.
            // But if we delete, we shift.
            const currentCount = this.vectors.length / this.index.dimensions;

            // Grow buffer
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
    }

    private deleteVector(path: string) {
        const entry = this.index.files[path];
        if (!entry) return;

        const idToRemove = entry.id;
        const count = this.vectors.length / this.index.dimensions;

        // 1. Remove from Index
        delete this.index.files[path];

        // 2. Remove from Buffer (Shift everyone after `idToRemove` down by 1 slot)
        // If it's the last one, just slice.
        if (idToRemove === count - 1) {
            this.vectors = this.vectors.slice(0, this.vectors.length - this.index.dimensions);
        } else {
            const newVectors = new Float32Array(this.vectors.length - this.index.dimensions);

            // Copy before
            if (idToRemove > 0) {
                newVectors.set(this.vectors.subarray(0, idToRemove * this.index.dimensions), 0);
            }

            // Copy after (shifted)
            const afterStart = (idToRemove + 1) * this.index.dimensions;
            if (afterStart < this.vectors.length) {
                newVectors.set(this.vectors.subarray(afterStart), idToRemove * this.index.dimensions);
            }

            this.vectors = newVectors;

            // 3. Update IDs of all shifted files
            for (const key in this.index.files) {
                const f = this.index.files[key];
                if (f && f.id > idToRemove) {
                    f.id--;
                }
            }
        }
    }

    private triggerBackoff() {
        if (this.isBackingOff) return;
        this.isBackingOff = true;
        this.currentDelayMs = 30000;

        setTimeout(() => {
            this.isBackingOff = false;
            logger.info("Resuming queue after backoff.");
            this.processQueue();
        }, 60000); // Wait 60s
    }

    public findSimilar(queryVector: number[] | string, limit?: number, threshold?: number): any[] {
        let query: number[];
        if (typeof queryVector === 'string') throw new Error("Pass embedded vector");
        query = queryVector;

        const minScore = threshold ?? this.minSimilarityScore;

        const count = this.vectors.length / this.index.dimensions;
        logger.info(`Searching ${count} vectors. Threshold: ${minScore}, Limit: ${limit}`);

        const scores: { id: number, score: number }[] = [];

        // Brute force cosine similarity against the flat buffer
        for (let i = 0; i < count; i++) {
            const start = i * this.index.dimensions;
            const vec = this.vectors.subarray(start, start + this.index.dimensions);
            const score = this.cosineSimilarity(query, vec);

            // Log high scores for debugging
            // if (score > 0.3) logger.debug(`Vector ${i} score: ${score}`);

            if (score >= minScore) {
                scores.push({ id: i, score });
            }
        }

        scores.sort((a, b) => b.score - a.score);

        let matches = scores;

        // DEBUG: Log the top 5 matches regardless of threshold if we found nothing or few
        if (matches.length < 5) {
            const allScores: { id: number, score: number }[] = [];
            for (let i = 0; i < count; i++) {
                const start = i * this.index.dimensions;
                const vec = this.vectors.subarray(start, start + this.index.dimensions);
                const score = this.cosineSimilarity(query, vec);
                allScores.push({ id: i, score });
            }
            allScores.sort((a, b) => b.score - a.score);
            const top5 = allScores.slice(0, 5);
            logger.info("Top 5 raw matches (ignoring threshold):");
            top5.forEach(m => {
                const path = Object.keys(this.index.files).find(p => this.index.files[p]?.id === m.id);
                logger.info(` - ${path}: ${m.score}`);
            });
        }

        if (limit && limit > 0) {
            matches = matches.slice(0, limit);
        }

        // Map back to file paths
        return matches.map(match => {
            // Find path for this ID
            const path = Object.keys(this.index.files).find(p => {
                const f = this.index.files[p];
                return f && f.id === match.id;
            });
            return {
                path: path,
                score: match.score,
            };
        }).filter(item => item.path); // Should always be found
    }

    // Adjusted to take Float32Array or number[]
    private cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
        let dot = 0;
        let magA = 0;
        let magB = 0;
        // Assuming equal length 768
        for (let i = 0; i < a.length; i++) {
            const valA = a[i] ?? 0;
            const valB = b[i] ?? 0;
            dot += valA * valB;
            magA += valA * valA;
            magB += valB * valB;
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }
}
