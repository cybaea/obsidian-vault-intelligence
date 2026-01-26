import * as Comlink from 'comlink';
import Graph from 'graphology';
import { search, type AnyOrama, type RawData } from '@orama/orama';
import { WorkerAPI, WorkerConfig, GraphNodeData, GraphSearchResult } from '../types/graph';
import { ONTOLOGY_CONSTANTS, WORKER_INDEXER_CONSTANTS } from '../constants';
import { workerNormalizePath, resolvePath, splitFrontmatter, extractLinks } from '../utils/link-parsing';

let graph: Graph;
let orama: AnyOrama;
let config: WorkerConfig;
let embedderProxy: ((text: string, title: string) => Promise<number[]>) | null = null;
const aliasMap: Map<string, string> = new Map(); // alias lower -> canonical path

interface OramaDocument {
    [key: string]: string | number | boolean | number[] | undefined;
    path: string;
    title: string;
    content: string;
    embedding?: number[];
}

interface SerializedIndexState {
    graph: object;
    orama: RawData;
    embeddingDimension: number;
    embeddingModel: string;
}

// Match project logger format: [VaultIntelligence:LEVEL]
const workerLogger = {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[VaultIntelligence:DEBUG] [IndexerWorker] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:INFO] [IndexerWorker] ${msg}`, ...args), // Obsidian convention
    warn: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:WARN] [IndexerWorker] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[VaultIntelligence:ERROR] [IndexerWorker] ${msg}`, ...args)
};

const IndexerWorker: WorkerAPI = {
    /**
     * Initializes the worker state, including Orama and Graphology.
     * @param conf - Worker configuration.
     * @param fetcher - Proxy for requestUrl (not used directly).
     * @param embedder - Proxy for the embedding service.
     */
    async initialize(conf: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<number[]>) {
        config = conf;
        graph = new Graph();
        if (typeof embedder === 'function') embedderProxy = embedder;

        // Initialize Orama with vector support
        await recreateOrama();
        await Promise.resolve();

        workerLogger.info(`Initialized Orama with ${conf.embeddingDimension} dimensions and ${conf.embeddingModel}`);
    },

    /**
     * Updates the local alias map for link resolution from main thread source of truth.
     * @param map - Record of aliases to canonical paths.
     */
    async updateAliasMap(map: Record<string, string>) {
        await Promise.resolve();
        // Clear and reload alias map from main thread source of truth
        aliasMap.clear();
        for (const [alias, path] of Object.entries(map)) {
            aliasMap.set(alias.toLowerCase(), workerNormalizePath(path));
        }
        workerLogger.debug(`Updated alias map with ${aliasMap.size} entries.`);
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
                    states[node] = { mtime: a.mtime, hash: a.hash || '' };
                }
            });
        }
        return states;
    },

    /**
     * Updates a file in both Orama (content/vector) and Graphology (links).
     * @param path - File path.
     * @param content - File content.
     * @param mtime - Modification time.
     * @param size - File size.
     * @param title - File title.
     */
    async updateFile(path: string, content: string, mtime: number, size: number, title: string) {
        const normalizedPath = workerNormalizePath(path);

        // 1. Hash check
        const hash = await computeHash(content);
        const isEmpty = content.trim().length === 0;
        const needsOrama = !isEmpty;
        let forceReindex = false;

        const { getByID } = await import('@orama/orama');
        const existingOramaDoc = getByID(orama, normalizedPath) as unknown as OramaDocument | undefined;

        // Force re-index if not in Orama OR missing embedding OR dimension mismatch
        if (needsOrama && (!existingOramaDoc || !existingOramaDoc.embedding || existingOramaDoc.embedding.length !== config.embeddingDimension)) {
            forceReindex = true;
            const reason = !existingOramaDoc ? 'Missing from Orama' :
                (!existingOramaDoc.embedding ? 'Missing embedding' :
                    `Dimension mismatch (${existingOramaDoc.embedding.length} !== ${config.embeddingDimension})`);
            workerLogger.debug(`Forcing re-index for ${normalizedPath}: ${reason}`);
        }

        // 1b. Empty content guard
        const trimmedLength = content.trim().length;
        if (trimmedLength === 0) {
            workerLogger.debug(`Skipping Orama indexing for empty/whitespace-only file: ${normalizedPath}`);
            if (graph.hasNode(normalizedPath)) {
                graph.updateNodeAttributes(normalizedPath, (oldAttr: unknown) => ({
                    ...(oldAttr as GraphNodeData),
                    mtime,
                    size,
                    hash,
                    title
                }));
            } else {
                graph.addNode(normalizedPath, { path: normalizedPath, type: 'file', mtime, size, hash, title });
            }
            return;
        }

        if (graph.hasNode(normalizedPath)) {
            const attr = graph.getNodeAttributes(normalizedPath) as GraphNodeData;
            if (attr.hash === hash && !forceReindex) {
                return; // Unchanged and already in Orama
            }
            graph.updateNodeAttributes(normalizedPath, (oldAttr: unknown) => ({
                ...(oldAttr as GraphNodeData),
                mtime,
                size,
                hash,
                title
            }));
        } else {
            graph.addNode(normalizedPath, {
                path: normalizedPath,
                type: 'file',
                mtime,
                size,
                hash,
                title
            });
        }

        // 2. Parse Links (Source-Aware)
        const { frontmatter, body } = splitFrontmatter(content);
        const fmLinks = extractLinks(frontmatter);
        const bodyLinks = extractLinks(body);

        for (const link of fmLinks) {
            const resolvedPath = resolvePath(link, aliasMap);
            if (!graph.hasNode(resolvedPath)) {
                graph.addNode(resolvedPath, { path: resolvedPath, type: 'file', mtime: 0, size: 0 });
            }
            if (graph.hasEdge(normalizedPath, resolvedPath)) continue;

            graph.addEdge(normalizedPath, resolvedPath, {
                type: 'link',
                weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER,
                source: 'frontmatter'
            });
        }

        for (const link of bodyLinks) {
            const resolvedPath = resolvePath(link, aliasMap);
            if (!graph.hasNode(resolvedPath)) {
                graph.addNode(resolvedPath, { path: resolvedPath, type: 'file', mtime: 0, size: 0 });
            }
            if (graph.hasEdge(normalizedPath, resolvedPath)) continue;

            graph.addEdge(normalizedPath, resolvedPath, {
                type: 'link',
                weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.BODY,
                source: 'body'
            });
        }

        try {
            const embedding = await generateEmbedding(content, title);
            if (embedding.length !== config.embeddingDimension) {
                workerLogger.error(`Dimension mismatch for ${normalizedPath}: expected ${config.embeddingDimension}, got ${embedding.length}`);
                return;
            }

            const { upsert } = await import('@orama/orama');
            await upsert(orama, {
                id: normalizedPath,
                path: normalizedPath,
                title,
                content: content.slice(0, WORKER_INDEXER_CONSTANTS.CONTENT_PREVIEW_LENGTH),
                embedding
            });
        } catch (error) {
            const msg = String(error);
            if (msg.includes("API key") || msg.includes("400") || msg.includes("401")) {
                throw error;
            }
            workerLogger.error(`Failed to index ${normalizedPath}:`, error);
        }
    },

    /**
     * Removes a file from the graph and index.
     * @param path - File path to delete.
     */
    async deleteFile(path: string) {
        if (graph.hasNode(path)) {
            graph.dropNode(path);
        }
        try {
            const { remove } = await import('@orama/orama');
            await remove(orama, path);
        } catch (e) {
            workerLogger.warn(`Failed to remove ${path} from Orama:`, e);
        }
        return Promise.resolve();
    },

    /**
     * Handles file renames by updating the graph node ID and Orama index.
     * @param oldPath - Original file path.
     * @param newPath - New file path.
     */
    async renameFile(oldPath: string, newPath: string) {
        if (graph.hasNode(oldPath)) {
            const attr = graph.getNodeAttributes(oldPath);
            graph.dropNode(oldPath);
            graph.addNode(newPath, { ...(attr as GraphNodeData), path: newPath });
        }
        try {
            const { remove } = await import('@orama/orama');
            await remove(orama, oldPath);
        } catch (e) {
            workerLogger.warn(`Failed to remove ${oldPath} from Orama during rename:`, e);
        }
        return Promise.resolve();
    },

    /**
     * Performs a vector search on the Orama index.
     * @param query - Search query.
     * @param limit - Maximum number of hits.
     */
    async search(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const results = await search(orama, {
            mode: 'vector',
            vector: {
                value: await generateEmbedding(query, 'Query'),
                property: 'embedding'
            },
            limit
        });

        return results.hits.map(hit => ({
            path: hit.document.path as string,
            score: hit.score,
            title: hit.document.title as string,
            excerpt: hit.document.content as string
        }));
    },

    /**
     * Performs a vector search restricted to specific paths.
     * @param query - Search query.
     * @param paths - Allowed paths.
     * @param limit - Maximum number of hits.
     */
    async searchInPaths(query: string, paths: string[], limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const normalizedPaths = paths.map(p => workerNormalizePath(p));
        const results = await search(orama, {
            mode: 'vector',
            vector: {
                value: await generateEmbedding(query, 'Query'),
                property: 'embedding'
            },
            where: {
                path: { in: normalizedPaths }
            },
            limit
        });

        return results.hits.map(hit => ({
            path: hit.document.path as string,
            score: hit.score,
            title: hit.document.title as string,
            excerpt: hit.document.content as string
        }));
    },

    /**
     * Finds files similar to a given document using vector similarity.
     * @param path - Source file path.
     * @param limit - Maximum number of hits.
     */
    async getSimilar(path: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        if (!orama) return [];
        const normalizedPath = workerNormalizePath(path);

        const docResult = await search(orama, {
            where: {
                path: { eq: normalizedPath }
            },
            limit: 1,
            includeVectors: true
        });

        const firstHit = docResult.hits[0];
        if (!firstHit) return [];

        if (!firstHit.document.embedding) return [];

        const embedding = firstHit.document.embedding as number[];
        if (embedding.length === 0) return [];

        const results = await search(orama, {
            mode: 'vector',
            vector: {
                value: embedding,
                property: 'embedding'
            },
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            where: {
                path: { nin: [normalizedPath] }
            },
            limit: WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEEP
        } as Parameters<typeof search>[1]);

        const minScore = config.minSimilarityScore ?? 0;
        const uniqueHits = new Map<string, GraphSearchResult>();

        for (const hit of results.hits) {
            if (hit.score < minScore) continue;

            const doc = hit.document as OramaDocument;
            const docPath = doc.path;

            const existing = uniqueHits.get(docPath);
            if (!existing || hit.score > existing.score) {
                uniqueHits.set(docPath, {
                    path: docPath,
                    score: hit.score,
                    title: String(doc.title),
                    excerpt: String(doc.content)
                });
            }
        }

        return Array.from(uniqueHits.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    },

    /**
     * Gets neighbors in the graph, with optional ontology-based expansion.
     * @param path - Source file path.
     * @param options - Traversal options.
     */
    async getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology' }): Promise<GraphSearchResult[]> {
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
                path: neighbor,
                score: 1.0,
                title: attr.title || neighbor.split('/').pop()?.replace('.md', ''),
                excerpt: ""
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

                        let score = ONTOLOGY_CONSTANTS.SIBLING_DECAY;
                        if (ONTOLOGY_CONSTANTS.HUB_PENALTY_ENABLED) {
                            score = score / Math.max(1, Math.log10(degree + 1));
                        }

                        const attr = graph.getNodeAttributes(sibling) as GraphNodeData;
                        results.set(sibling, {
                            path: sibling,
                            score: score,
                            title: attr.title || sibling.split('/').pop()?.replace('.md', ''),
                            excerpt: `(Sibling via ${neighbor})`
                        });
                    }
                }
            }
        }

        return Array.from(results.values());
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
     * Serializes the current graph and Orama index to a JSON string.
     */
    async saveIndex(): Promise<string> {
        const { save } = await import('@orama/orama');
        const serialized = {
            graph: graph.export(),
            orama: save(orama),
            embeddingDimension: config.embeddingDimension,
            embeddingModel: config.embeddingModel
        };
        return JSON.stringify(serialized);
    },

    /**
     * Loads a serialized graph and index state from a JSON string.
     * @param data - Serialized state string.
     */
    async loadIndex(data: string) {
        const { load, count } = await import('@orama/orama');
        const parsed = JSON.parse(data) as SerializedIndexState;

        graph.clear();
        if (parsed.graph) graph.import(parsed.graph);

        if (parsed.orama) {
            const loadedDimension = parsed.embeddingDimension;
            const expectedDimension = config.embeddingDimension;
            const loadedModel = parsed.embeddingModel;
            const expectedModel = config.embeddingModel;

            const modelMismatch = loadedModel !== undefined && loadedModel !== expectedModel;
            const dimMismatch = loadedDimension !== undefined && loadedDimension !== expectedDimension;

            if (modelMismatch || dimMismatch || loadedDimension === undefined) {
                await recreateOrama();
            } else {
                load(orama, parsed.orama as unknown as RawData);
                const total = count(orama);

                const { remove, search } = await import('@orama/orama');
                const allDocs = await search(orama, {
                    limit: total,
                    includeVectors: true
                });

                for (const hit of allDocs.hits) {
                    const doc = hit.document as unknown as OramaDocument;
                    if (hit.id !== doc.path || !doc.embedding) {
                        await remove(orama, hit.id);
                    }
                }
            }
        }
        return Promise.resolve();
    },

    /**
     * Updates worker configuration and recreates index if critical settings changed.
     * @param newConfig - Partial worker configuration.
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
     * Clears the Orama index.
     */
    async clearIndex() {
        await recreateOrama();
    },

    /**
     * Resets both the graph and Orama index.
     */
    async fullReset() {
        graph.clear();
        await recreateOrama();
    }
};

/**
 * Recreates the Orama index with the current configuration.
 */
async function recreateOrama() {
    const { create } = await import('@orama/orama');
    orama = create({
        schema: {
            path: 'enum',
            title: 'string',
            content: 'string',
            embedding: `vector[${config.embeddingDimension}]`
        }
    });
}

/**
 * Computes a SHA-256 hash of a string for change detection.
 */
async function computeHash(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    const hashAsBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashAsBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Proxy function to call the embedding service in the main thread.
 */
async function generateEmbedding(text: string, title: string): Promise<number[]> {
    if (!embedderProxy) {
        throw new Error("Embedding proxy not initialized.");
    }
    return await embedderProxy(text, title);
}

if (typeof postMessage !== 'undefined' && typeof addEventListener !== 'undefined') {
    Comlink.expose(IndexerWorker);
}
