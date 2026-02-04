import { encode, decode } from '@msgpack/msgpack';
import { search, type AnyOrama, type RawData } from '@orama/orama';
import * as Comlink from 'comlink';
import Graph from 'graphology';

import { ONTOLOGY_CONSTANTS, WORKER_INDEXER_CONSTANTS, SEARCH_CONSTANTS, GRAPH_CONSTANTS } from '../constants';
import { WorkerAPI, WorkerConfig, GraphNodeData, GraphSearchResult } from '../types/graph';
import { workerNormalizePath, resolvePath, splitFrontmatter, extractLinks } from '../utils/link-parsing';

let graph: Graph;
let orama: AnyOrama;
let config: WorkerConfig;
let embedderProxy: ((text: string, title: string) => Promise<number[]>) | null = null;
const aliasMap: Map<string, string> = new Map(); // alias lower -> canonical path

interface OramaDocument {
    [key: string]: string | number | boolean | number[] | undefined | string[];
    author?: string; // New: Explicit author field
    content: string;
    // New Metadata
    created: number;
    embedding?: number[];
    params: string[];
    path: string;
    status: string;
    title: string;
}

interface OramaHit {
    document: OramaDocument;
    id: string;
    score: number;
}

interface SerializedIndexState {
    embeddingDimension: number;
    embeddingModel: string;
    graph: object;
    orama: RawData;
}

// Match project logger format: [VaultIntelligence:LEVEL]
const workerLogger = {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[VaultIntelligence:DEBUG] [IndexerWorker] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[VaultIntelligence:ERROR] [IndexerWorker] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:INFO] [IndexerWorker] ${msg}`, ...args), // Obsidian convention
    warn: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:WARN] [IndexerWorker] ${msg}`, ...args)
};

const IndexerWorker: WorkerAPI = {
    /**
     * Clears the Orama index.
     */
    async clearIndex() {
        await recreateOrama();
    },

    /**
     * Removes a file from the graph and index.
     * Use Query-Delete to remove all chunks associated with the path.
     * @param path - File path to delete.
     */
    async deleteFile(path: string) {
        if (graph.hasNode(path)) {
            graph.dropNode(path);
        }
        try {
            // Updated: Delete all chunks for this path
            const { remove, search } = await import('@orama/orama');
            const chunks = await search(orama, {
                limit: 1000,
                where: { path: { eq: path } }
            });

            const ids = chunks.hits.map(h => h.id);
            if (ids.length > 0) {
                for (const id of ids) {
                    await remove(orama, id);
                }
            }
        } catch (e) {
            workerLogger.warn(`Failed to remove ${path} from Orama:`, e);
        }
        return Promise.resolve();
    },

    /**
     * Resets both the graph and Orama index.
     */
    async fullReset() {
        if (graph) graph.clear();
        await recreateOrama();
    },

    /**
     * Calculates degree centrality for multiple nodes.
     * @param paths - Array of node paths.
     */
    async getBatchCentrality(paths: string[]): Promise<Record<string, number>> {
        await Promise.resolve();
        const results: Record<string, number> = {};
        const totalNodes = graph.order;

        for (const path of paths) {
            const normalizedPath = workerNormalizePath(path);
            if (!graph.hasNode(normalizedPath)) {
                results[path] = 0;
            } else {
                const degree = graph.degree(normalizedPath);
                results[path] = totalNodes > 1 ? degree / (totalNodes - 1) : 0;
            }
        }
        return results;
    },

    /**
     * Calculates metadata for multiple nodes.
     * @param paths - Array of node paths.
     */
    async getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string, headers?: string[] }>> {
        await Promise.resolve();
        const results: Record<string, { title?: string, headers?: string[] }> = {};

        for (const path of paths) {
            const normalizedPath = workerNormalizePath(path);
            if (graph.hasNode(normalizedPath)) {
                const attr = graph.getNodeAttributes(normalizedPath) as GraphNodeData;
                results[path] = {
                    headers: attr.headers,
                    title: attr.title
                };
            } else {
                results[path] = {};
            }
        }
        return results;
    },

    /**
     * Calculates degree centrality for a node normalized by graph size.
     * @param path - Node path.
     */
    async getCentrality(path: string): Promise<number> {
        await Promise.resolve();
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return 0;

        const degree = graph.degree(normalizedPath);
        const totalNodes = graph.order;
        return totalNodes > 1 ? degree / (totalNodes - 1) : 0;
    },

    /**
     * Returns the mtime and hash for all tracked files.
     * @returns Record of file paths to their metadata.
     */
    async getFileStates() {
        await Promise.resolve(); // Satisfy linter for async method
        const states: Record<string, { mtime: number, hash: string }> = {};
        if (graph) {
            graph.forEachNode((node, attr) => {
                const a = attr as GraphNodeData;
                if (a.type === 'file') {
                    states[node] = { hash: a.hash || '', mtime: a.mtime };
                }
            });
        }
        return states;
    },

    /**
     * Gets neighbors in the graph, with optional ontology-based expansion.
     * @param path - Source file path.
     * @param options - Traversal options.
     */
    async getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<GraphSearchResult[]> {
        await Promise.resolve();
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return [];

        const direction = options?.direction || 'both';
        const mode = options?.mode || 'simple';

        const getOneHop = (node: string, dir: 'both' | 'inbound' | 'outbound') => {
            if (dir === 'outbound') return graph.outNeighbors(node);
            if (dir === 'inbound') return graph.inNeighbors(node);
            return graph.neighbors(node);
        };

        const initialNeighbors = getOneHop(normalizedPath, direction);
        const results = new Map<string, GraphSearchResult>();

        for (const neighbor of initialNeighbors) {
            const attr = graph.getNodeAttributes(neighbor) as GraphNodeData;
            results.set(neighbor, {
                excerpt: "",
                path: neighbor,
                score: 1.0,
                title: attr.title || neighbor.split('/').pop()?.replace('.md', '')
            });
        }

        if (mode === 'ontology') {
            for (const neighbor of initialNeighbors) {
                const configuredOntology = workerNormalizePath(config.ontologyPath || 'Ontology');
                const isOntologyPath = neighbor.startsWith(configuredOntology + '/');
                const degree = graph.inDegree(neighbor);
                const isHub = degree >= ONTOLOGY_CONSTANTS.HUB_MIN_DEGREE;

                if (isOntologyPath || isHub) {
                    const siblings = graph.inNeighbors(neighbor);
                    for (const sibling of siblings) {
                        if (sibling === normalizedPath) continue;
                        if (results.has(sibling)) continue;

                        let score = options?.decay ?? ONTOLOGY_CONSTANTS.SIBLING_DECAY;
                        if (ONTOLOGY_CONSTANTS.HUB_PENALTY_ENABLED) {
                            score = score / Math.max(1, Math.log10(degree + 1));
                        }

                        const attr = graph.getNodeAttributes(sibling) as GraphNodeData;
                        results.set(sibling, {
                            excerpt: `(Sibling via ${neighbor})`,
                            path: sibling,
                            score: score,
                            title: attr.title || sibling.split('/').pop()?.replace('.md', '')
                        });
                    }
                }
            }
        }

        return Array.from(results.values());
    },

    /**
     * Finds files similar to a given document using Centroid Vector Search.
     * 1. Get all chunks for the file.
     * 2. Calculate average vector (centroid).
     * 3. Search using centroid.
     * 4. Max-Pool results.
     * @param path - Source file path.
     * @param limit - Maximum number of hits.
     */
    async getSimilar(path: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        if (!orama) return [];
        const normalizedPath = workerNormalizePath(path);

        // 1. Fetch all chunks for source
        const docResult = await search(orama, {
            includeVectors: true,
            limit: 100, // Reasonable max chunks per file
            where: {
                path: { eq: normalizedPath }
            }
        });

        if (!docResult.hits.length) return [];

        // 2. Compute Centroid
        const vectors = docResult.hits
            .map(h => h.document.embedding as number[])
        if (vectors.length === 0) return [];
        if (!vectors[0]) return []; // Safety check

        const dim = vectors[0].length;
        const centroid = new Array(dim).fill(0);

        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) {
                centroid[i] += vec[i];
            }
        }
        for (let i = 0; i < dim; i++) {
            centroid[i] = centroid[i] / vectors.length;
        }

        // 3. Search with Centroid
        const results = await search(orama, {
            limit: WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEEP, // Overshoot for pooling
            mode: 'vector',
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            vector: {
                property: 'embedding',
                value: centroid
            },
            where: {
                path: { nin: [normalizedPath] }
            }
        } as Parameters<typeof search>[1]);

        return maxPoolResults(results.hits as unknown as OramaHit[], limit, config.minSimilarityScore ?? 0);
    },

    /**
     * Initializes the worker state, including Orama and Graphology.
     * @returns True if successful, False implies incompatibility should trigger wipe.
     */
    async initialize(conf: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<number[]>) {
        config = conf;
        graph = new Graph();
        if (typeof embedder === 'function') embedderProxy = embedder;

        // Initialize Orama with vector support
        await recreateOrama();
        await Promise.resolve();

        workerLogger.info(`Initialized Orama with ${conf.embeddingDimension} dimensions and ${conf.embeddingModel}`);
        return true;
    },

    /**
     * Performs a keyword search on the Orama index.
     * Uses Max-Pooling to return unique files.
     */
    async keywordSearch(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const results = await search(orama, {
            limit: limit * 3, // Overshoot
            properties: ['title', 'content', 'params', 'status'],
            term: query
        });

        return maxPoolResults(results.hits as unknown as OramaHit[], limit, 0);
    },

    /**
     * Loads a serialized graph and index state.
     * Returns TRUE if successful, FALSE if incompatible (schema mismatch).
     */
    async loadIndex(data: string | Uint8Array): Promise<boolean> {
        const { count, load } = await import('@orama/orama');

        let parsed: SerializedIndexState;
        try {
            if (typeof data === 'string') {
                workerLogger.debug(`[loadIndex] Received string data: ${data.length} chars`);
                parsed = JSON.parse(data) as SerializedIndexState;
            } else {
                workerLogger.debug(`[loadIndex] Received binary data: ${data.byteLength} bytes`);
                parsed = decode(data) as SerializedIndexState;
            }
            workerLogger.debug(`[loadIndex] Decoded: graph=${!!parsed.graph}, orama=${!!parsed.orama}, dim=${parsed.embeddingDimension}, model=${parsed.embeddingModel}`);
        } catch (e) {
            workerLogger.error("Failed to decode index state", e);
            return false;
        }

        if (parsed.graph) graph.import(parsed.graph);

        if (parsed.orama) {
            const loadedDimension = parsed.embeddingDimension;
            const expectedDimension = config.embeddingDimension;
            const loadedModel = parsed.embeddingModel;
            const expectedModel = config.embeddingModel;

            const modelMismatch = loadedModel !== undefined && loadedModel !== expectedModel;
            const dimMismatch = loadedDimension !== undefined && loadedDimension !== expectedDimension;

            if (modelMismatch || dimMismatch || loadedDimension === undefined) {
                workerLogger.warn(`Index mismatch: modelMismatch=${String(modelMismatch)} (${loadedModel} vs ${expectedModel}), dimMismatch=${String(dimMismatch)} (${loadedDimension} vs ${expectedDimension}), loadedDimensionUndef=${loadedDimension === undefined}`);
                await recreateOrama();
                return false; // Signal migration
            }

            try {
                load(orama, parsed.orama);
                const total = count(orama);
                if (total > 0) {
                    // Check schema compatibility on a sample
                    const { search } = await import('@orama/orama');
                    const sample = await search(orama, { limit: 1 });
                    if (sample.hits.length > 0) {
                        const hit = sample.hits[0];
                        if (hit && hit.document) {
                            const doc = hit.document as unknown as OramaDocument;
                            if (doc.created === undefined || doc.params === undefined) {
                                workerLogger.warn("Loaded index has old schema. Triggering migration.");
                                await recreateOrama();
                                return false;
                            }
                        }
                    }
                }
            } catch (e) {
                workerLogger.warn("Orama load failed (internal schema check?)", e);
                return false;
            }
        }
        return true;
    },

    /**
     * Handles file renames by updating the graph node ID and Orama index.
     */
    async renameFile(oldPath: string, newPath: string) {
        if (graph.hasNode(oldPath)) {
            const attr = graph.getNodeAttributes(oldPath);
            graph.dropNode(oldPath);
            graph.addNode(newPath, { ...(attr as GraphNodeData), path: newPath });
        }
        // Query-Delete old chunks
        await IndexerWorker.deleteFile(oldPath);
        // Note: New content will be added by a subsequent updateFile call from main thread
    },

    /**
     * Serializes the current graph and Orama index to a MessagePack buffer.
     */
    async saveIndex(): Promise<Uint8Array> {
        const { save } = await import('@orama/orama');
        const oramaRaw = save(orama);

        // Architectural Fix: Check for circularity to ensure we aren't masking a structural bug.
        // Orama and Graphology exports should be DAGs.
        if (isCircular(oramaRaw)) {
            workerLogger.error("Circularity detected in Orama state! Serialization aborted.");
            throw new Error("Circularity detected in Orama state");
        }

        const serialized: SerializedIndexState = {
            embeddingDimension: config.embeddingDimension,
            embeddingModel: config.embeddingModel,
            graph: graph.export(),
            orama: oramaRaw
        };

        workerLogger.info(`[saveIndex] Model: ${config.embeddingModel}, Dimension: ${config.embeddingDimension}`);
        return encode(serialized, { maxDepth: GRAPH_CONSTANTS.MAX_SERIALIZATION_DEPTH });
    },

    /**
     * Performs a vector search on the Orama index.
     * Uses Max-Pooling.
     */
    async search(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const results = await search(orama, {
            limit: limit * 4, // Higher limit for pooling
            mode: 'vector',
            vector: {
                property: 'embedding',
                value: await generateEmbedding(query, 'Query')
            }
        });

        return maxPoolResults(results.hits as unknown as OramaHit[], limit, config.minSimilarityScore ?? 0);
    },

    /**
     * Performs a vector search restricted to specific paths.
     */
    async searchInPaths(query: string, paths: string[], limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const normalizedPaths = paths.map(p => workerNormalizePath(p));
        const results = await search(orama, {
            limit: limit * 4,
            mode: 'vector',
            vector: {
                property: 'embedding',
                value: await generateEmbedding(query, 'Query')
            },
            where: {
                path: { in: normalizedPaths }
            }
        });

        return maxPoolResults(results.hits as unknown as OramaHit[], limit, config.minSimilarityScore ?? 0);
    },

    /**
     * Updates the local alias map for link resolution from main thread source of truth.
     */
    async updateAliasMap(map: Record<string, string>) {
        await Promise.resolve();
        aliasMap.clear();
        for (const [alias, path] of Object.entries(map)) {
            aliasMap.set(alias.toLowerCase(), workerNormalizePath(path));
        }
    },

    /**
     * Updates worker configuration and recreates index if critical settings changed.
     */
    async updateConfig(newConfig: Partial<WorkerConfig>) {
        const dimensionChanged = newConfig.embeddingDimension !== undefined && newConfig.embeddingDimension !== config.embeddingDimension;
        const modelChanged = newConfig.embeddingModel !== undefined && newConfig.embeddingModel !== config.embeddingModel;

        config = { ...config, ...newConfig };
        if (dimensionChanged || modelChanged) {
            await recreateOrama();
        }
        await Promise.resolve();
    },

    /**
     * Updates a file in both Orama (content/vector) and Graphology (links).
     * Chunking Strategy Implemented Here.
     */
    async updateFile(path: string, content: string, mtime: number, size: number, title: string) {
        const normalizedPath = workerNormalizePath(path);
        const hash = await computeHash(content);

        // 1. Graphology Update (unchanged logic for structure)
        updateGraphNode(normalizedPath, content, mtime, size, title, hash);
        updateGraphEdges(normalizedPath, content);

        if (content.trim().length === 0) return;

        // 2. Orama Update (Chunking)
        // Check if file changed (hash check).
        // Since chunks have different IDs, we can't easily check "existingOramaDoc" by path.
        // We rely on Hash. If hash matches graph, we assume index is good?
        // CAUTION: If we updated settings (context headers), hash might match but we WANT re-index.
        // For now, rely on hash. If user changes settings, they might need to force re-index or edit file.
        // BUT, we can store the "config hash" in the graph node?
        // Let's stick to content hash for now.
        // The `updateGraphNode` updates the hash.
        // The calling `GraphService` usually checks mtime before calling updateFile.
        // So we assume if updateFile is called, we MUST update.

        // Delete all existing chunks first (Query-Delete)
        await IndexerWorker.deleteFile(path);

        // 3. Prepare Context
        // NEW: Sanitize Content (Excalidraw)
        const cleanlyContent = sanitizeExcalidrawContent(content);

        const { body, frontmatter } = splitFrontmatter(cleanlyContent);
        const parsedFrontmatter = parseYaml(frontmatter);
        const contextString = generateContextString(title, parsedFrontmatter, config);

        // 4. Split
        const tokensPerChunk = 512; // Approx
        const charsPerToken = SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE || 4;
        const chunkSize = tokensPerChunk * charsPerToken;
        const overlap = Math.floor(chunkSize * 0.1);

        const chunks = recursiveCharacterSplitter(body, chunkSize, overlap);

        if (chunks.length === 0 && contextString.length > 0) {
            // Index at least the context/title if body is empty
            chunks.push("");
        }

        const { upsert } = await import('@orama/orama');
        const batchedDocs: OramaDocument[] = [];

        // Define strict Frontmatter type for safe access
        interface Frontmatter {
            [key: string]: unknown;
            author?: string;
            authors?: string[];
            status?: string;
            tags?: string[];
            topics?: string[];
            type?: string[];
        }
        const fm = parsedFrontmatter as Frontmatter;

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            const fullContent = (contextString + "\n" + chunkText).trim();
            const chunkId = `${normalizedPath}#chunk-${i}`;

            if (fullContent.length === 0) continue;

            const embedding = await generateEmbedding(fullContent, title); // Embed the chunk including context

            // Metadata Extraction
            const status = sanitizeProperty(fm.status || 'active');
            const tags = ensureArray(fm.tags).map((t: unknown) => sanitizeProperty(t));
            const topics = ensureArray(fm.topics).map((t: unknown) => sanitizeProperty(t));
            const types = ensureArray(fm.type).map((t: unknown) => sanitizeProperty(t));

            // Collect all params for broad filtering
            const params = [...new Set([...tags, ...topics, ...types])];

            batchedDocs.push({
                author: fm.author || undefined,
                content: fullContent,
                created: mtime,
                embedding: embedding,
                id: chunkId,
                params: params,
                path: normalizedPath,
                status: status,
                title: title
            });
        }

        // Parallel Upsert?
        // Sequence for safety for now
        for (const doc of batchedDocs) {
            await upsert(orama, doc);
        }
    }
};

// --- Helper Functions ---

interface OramaHit {
    document: OramaDocument;
    score: number;
}

function maxPoolResults(hits: OramaHit[], limit: number, minScore: number): GraphSearchResult[] {
    const uniqueHits = new Map<string, GraphSearchResult>();

    for (const hit of hits) {
        if (hit.score < minScore) continue;

        const doc = hit.document;
        const docPath = doc.path;

        const existing = uniqueHits.get(docPath);
        // Max Pooling: Keep if new score is higher
        if (!existing || hit.score > existing.score) {
            uniqueHits.set(docPath, {
                excerpt: String(doc.content), // Excerpt is the chunk content
                path: docPath,
                score: hit.score,
                title: String(doc.title)
            });
        }
    }

    return Array.from(uniqueHits.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function recursiveCharacterSplitter(text: string, chunkSize: number, overlap: number): string[] {
    if (text.length <= chunkSize) return [text];

    let finalChunks: string[] = [];
    let currentChunk = "";

    // Simple splitting strategy using separators priority
    // For specific implementation, we can use a recursive approach or a simpler iterative one
    // Iterative approach:
    // 1. Split by largest separator
    // 2. Recombine into chunks <= chunkSize

    // Let's implement a simplified robust version
    // Split by paragraph first
    let parts = text.split('\n\n');
    let separator = '\n\n';

    // If paragraphs are too big, try newlines
    if (parts.some(p => p.length > chunkSize)) {
        parts = text.split('\n');
        separator = '\n';
        if (parts.some(p => p.length > chunkSize)) {
            parts = text.split('. ');
            separator = '. ';
        }
    }

    // Recombine
    for (const part of parts) {
        if ((currentChunk.length + part.length + separator.length) > chunkSize) {
            if (currentChunk.length > 0) {
                finalChunks.push(currentChunk);
                // Handle overlap? 
                // Simple overlap: Include last N chars of previous chunk?
                // Or keep 'currentChunk' buffer. 
                // For now, simple chunking.
                const overlapTxt = currentChunk.slice(-overlap);
                currentChunk = overlapTxt + separator + part;
            } else {
                // Part itself is huge, force split?
                if (part.length > chunkSize) {
                    // Force split by char
                    for (let k = 0; k < part.length; k += chunkSize) {
                        finalChunks.push(part.slice(k, k + chunkSize));
                    }
                    currentChunk = "";
                } else {
                    currentChunk = part;
                }
            }
        } else {
            currentChunk += (currentChunk.length > 0 ? separator : "") + part;
        }
    }
    if (currentChunk.length > 0) finalChunks.push(currentChunk);

    return finalChunks;
}

function generateContextString(title: string, fm: unknown, conf: WorkerConfig): string {
    const parts: string[] = [];

    interface Frontmatter {
        [key: string]: unknown;
        author?: string;
        authors?: string[];
        type?: string;
    }
    const frontmatter = fm as Frontmatter;

    // Always include Title if not in Config? Or rely on config?
    // User plan: "Title defaults to basename".
    // We assume 'title' is always valuable context.
    // If user explicitly excludes it from valid settings, maybe we respect that, 
    // but the plan says "Defaults include title".

    // Standardize 'author'
    let authors: string[] = [];
    if (frontmatter.authors && Array.isArray(frontmatter.authors)) authors = frontmatter.authors;
    else if (frontmatter.author) authors = [frontmatter.author];

    // Check type for default author
    if (authors.length === 0) {
        const type = sanitizeProperty(frontmatter.type).toLowerCase();
        if (['idea', 'make', 'project', 'thought'].includes(type) && conf.authorName) {
            authors.push(conf.authorName);
        }
    }
    // Inject normalized authors back into fm view for the loop
    if (authors.length > 0) frontmatter.author = authors.join(', ');

    const props = conf.contextAwareHeaderProperties || ['title', 'topics', 'tags', 'type', 'author', 'status'];

    for (const key of props) {
        let val = frontmatter[key];
        if (key === 'title' && !val) val = title; // Default title

        if (val) {
            const sanitized = sanitizeProperty(val);
            if (sanitized && sanitized.length > 0) {
                // Capitalize key
                const label = key.charAt(0).toUpperCase() + key.slice(1);

                // SAFETY CAP: Limit array items to max 3
                if (Array.isArray(val)) {
                    const capped = (val as unknown[]).slice(0, 3).map(v => String(v));
                    parts.push(`${label}: ${capped.join(', ')}.`);
                } else {
                    parts.push(`${label}: ${sanitized}.`);
                }
            }
        }
    }

    // GLOBAL CONTEXT LIMIT: 300 characters
    // If we exceed this, we risk poisoning the vector.
    // Title/Author are prioritized as they are first in 'parts' (usually).
    // Let's join and truncate.
    let fullContext = parts.join(' ');
    const MAX_CONTEXT_CHARS = 300;

    if (fullContext.length > MAX_CONTEXT_CHARS) {
        // Try to preserve whole words/sentences if possible, but hard cap is safer
        fullContext = fullContext.substring(0, MAX_CONTEXT_CHARS) + "...";
    }

    return fullContext;

}

function sanitizeProperty(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map(v => sanitizeProperty(v)).join(', ');
    }
    if (typeof value !== 'string') return String(value);

    // Remove [[ ]] and |alias
    // Clean WikiLinks: [[Page|Alias]] -> Alias, [[Page]] -> Page
    let clean = value.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');
    return clean.trim();
}

/**
 * Ensures a value is an array, wrapping it if it is a single value, and returning an empty array if null/undefined.
 */
function ensureArray(val: unknown): unknown[] {
    if (val === null || val === undefined) return [];
    if (Array.isArray(val)) return val as unknown[];
    return [val];
}

/**
 * Detects circular references in an object to prevent infinite recursion during serialization.
 * Orama and Graphology exports should be Directed Acyclic Graphs (DAGs).
 */
function isCircular(obj: unknown): boolean {
    const stack = new WeakSet<object>();
    function check(val: unknown): boolean {
        if (val && typeof val === 'object' && val !== null) {
            if (stack.has(val)) return true;
            stack.add(val);
            // Process keys
            const keys = Object.keys(val);
            for (const key of keys) {
                if (check((val as Record<string, unknown>)[key])) return true;
            }
            stack.delete(val);
        }
        return false;
    }
    return check(obj);
}


/**
 * Removes `compressed-json` code blocks to prevent context poisoning from Excalidraw drawings.
 * Preserves the rest of the file (including "Text Elements" headers and content).
 */
function sanitizeExcalidrawContent(content: string): string {
    // Regex to remove `compressed-json` code blocks
    // Pattern: ```compressed-json [sS]*? ```
    return content.replace(/```compressed-json[\s\S]*?```/g, '');
}

function updateGraphNode(path: string, content: string, mtime: number, size: number, title: string, hash: string) {
    const headers = extractHeaders(content);
    if (!graph.hasNode(path)) {
        graph.addNode(path, { hash, headers, mtime, path, size, title, type: 'file' });
    } else {
        graph.updateNodeAttributes(path, (attr: unknown) => ({
            ...(attr as GraphNodeData), hash, headers, mtime, size, title
        }));
    }
}

function updateGraphEdges(path: string, content: string) {
    // Basic implementation based on previous code
    const { body, frontmatter } = splitFrontmatter(content);
    const fmLinks = extractLinks(frontmatter);
    const bodyLinks = extractLinks(body);

    for (const link of fmLinks) {
        const resolvedPath = resolvePath(link, aliasMap);
        if (!graph.hasNode(resolvedPath)) {
            graph.addNode(resolvedPath, { mtime: 0, path: resolvedPath, size: 0, type: 'file' });
        }
        if (graph.hasEdge(path, resolvedPath)) continue;

        graph.addEdge(path, resolvedPath, {
            source: 'frontmatter',
            type: 'link',
            weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER
        });
    }

    for (const link of bodyLinks) {
        const resolvedPath = resolvePath(link, aliasMap);
        if (!graph.hasNode(resolvedPath)) {
            graph.addNode(resolvedPath, { mtime: 0, path: resolvedPath, size: 0, type: 'file' });
        }
        if (graph.hasEdge(path, resolvedPath)) continue;

        graph.addEdge(path, resolvedPath, {
            source: 'body',
            type: 'link',
            weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.BODY
        });
    }
}

async function recreateOrama() {
    const { create } = await import('@orama/orama');
    orama = create({
        schema: {
            // New Metadata Fields
            author: 'string', // New: Indexed Author
            content: 'string',
            created: 'number',
            embedding: `vector[${config.embeddingDimension}]`,
            params: 'string[]', // For Tags/Topics
            path: 'enum',
            status: 'string',
            title: 'string'
        }
    });
}

async function computeHash(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    const hashAsBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    return Array.from(new Uint8Array(hashAsBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractHeaders(text: string): string[] {
    const headers: string[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
        const match = line.match(/^(#{1,3})\s+(.*)$/);
        if (match) headers.push(line.trim());
    }
    return headers;
}

async function generateEmbedding(text: string, title: string): Promise<number[]> {
    if (!embedderProxy) throw new Error("Embedding proxy not initialized.");
    return await embedderProxy(text, title);
}

/**
 * Simple YAML parser for Frontmatter.
 * Handles:
 * - key: value
 * - key: [list]
 * - key:
 *   - list item
 */
function parseYaml(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');
    let currentKey: string | null = null;

    for (const line of lines) {
        if (line.trim() === '---') continue;
        if (line.trim().length === 0) continue;

        // Check for List Item "- value" (indented or not)
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (listMatch && listMatch[1] && currentKey) {
            const val = listMatch[1].trim();
            const existing = result[currentKey];
            if (Array.isArray(existing)) {
                existing.push(val);
            } else {
                result[currentKey] = [val];
            }
            continue;
        }

        // Check for Key: Value
        const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (keyMatch && keyMatch[1] && keyMatch[2] !== undefined) {
            const key = keyMatch[1];
            let value = keyMatch[2].trim();
            currentKey = key;

            // Handle inline list [a, b]
            if (value.startsWith('[') && value.endsWith(']')) {
                const content = value.slice(1, -1);
                // Simple comma split, ignoring quotes complexity for now
                result[key] = content.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else if (value.length > 0) {
                // Remove surrounding quotes
                value = value.replace(/^['"]|['"]$/g, '');
                result[key] = value;
            } else {
                // Empty value, might be start of list
                result[key] = [];
            }
        }
    }
    return result;
}

if (typeof postMessage !== 'undefined' && typeof addEventListener !== 'undefined') {
    Comlink.expose(IndexerWorker);
}

// Export a dummy class to satisfy the main thread import type check.
// This allows 'import Worker from ...' to see a Worker constructor.
export default class IndexerWorkerHelper extends Worker {
    constructor() {
        super('worker');
    }
}
