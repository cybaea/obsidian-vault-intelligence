import { encode, decode } from '@msgpack/msgpack';
import { search, type AnyOrama, type RawData } from '@orama/orama';
import * as Comlink from 'comlink';
import Graph from 'graphology';

import { ONTOLOGY_CONSTANTS, WORKER_INDEXER_CONSTANTS, SEARCH_CONSTANTS, GRAPH_CONSTANTS, WORKER_LATENCY_CONSTANTS } from '../constants';
import { WorkerAPI, WorkerConfig, GraphNodeData, GraphSearchResult } from '../types/graph';
import { workerNormalizePath, resolvePath, splitFrontmatter, extractLinks } from '../utils/link-parsing';

let graph: Graph;
let orama: AnyOrama;
let config: WorkerConfig;
let embedderProxy: ((text: string, title: string) => Promise<number[]>) | null = null;
const aliasMap: Map<string, string> = new Map(); // alias lower -> canonical path
let currentStopWords: string[] = []; // Loaded dynamically

interface StopWordsModule {
    stopwords: string[];
}

// Helper to normalize language code for Orama
function getOramaLanguage(language: string): string {
    const normalized = language.toLowerCase().trim();
    if (normalized.startsWith('ar')) return 'arabic';
    if (normalized.startsWith('hy')) return 'armenian';
    if (normalized.startsWith('bg')) return 'bulgarian';
    if (normalized.startsWith('zh')) return 'chinese';
    if (normalized.startsWith('da')) return 'danish';
    if (normalized.startsWith('nl')) return 'dutch';
    if (normalized.startsWith('en')) return 'english';
    if (normalized.startsWith('fi')) return 'finnish';
    if (normalized.startsWith('fr')) return 'french';
    if (normalized.startsWith('de')) return 'german';
    if (normalized.startsWith('el')) return 'greek';
    if (normalized.startsWith('hi')) return 'hindi';
    if (normalized.startsWith('hu')) return 'hungarian';
    if (normalized.startsWith('id')) return 'indonesian';
    if (normalized.startsWith('ga')) return 'irish';
    if (normalized.startsWith('it')) return 'italian';
    if (normalized.startsWith('ne')) return 'nepali';
    if (normalized.startsWith('no')) return 'norwegian';
    if (normalized.startsWith('pt')) return 'portuguese';
    if (normalized.startsWith('ro')) return 'romanian';
    if (normalized.startsWith('ru')) return 'russian';
    if (normalized.startsWith('sa')) return 'sanskrit';
    if (normalized.startsWith('sr')) return 'serbian';
    if (normalized.startsWith('sl')) return 'slovenian';
    if (normalized.startsWith('es')) return 'spanish';
    if (normalized.startsWith('sv')) return 'swedish';
    if (normalized.startsWith('ta')) return 'tamil';
    if (normalized.startsWith('tr')) return 'turkish';
    if (normalized.startsWith('uk')) return 'ukrainian';

    return 'english'; // Default
}

// Language Normalization & Stop Word Loading
async function loadStopWords(language: string): Promise<string[]> {
    try {
        const normalized = language.toLowerCase().trim();
        // 1. Try exact match mappings
        // 2. Try prefix (en-GB -> en)
        // 3. Map to @orama/stopwords exports

        let langCode = 'english'; // Default

        if (normalized.startsWith('ar')) langCode = 'arabic';
        else if (normalized.startsWith('hy')) langCode = 'armenian';
        else if (normalized.startsWith('bg')) langCode = 'bulgarian';
        else if (normalized.startsWith('zh')) langCode = 'chinese';
        else if (normalized.startsWith('da')) langCode = 'danish';
        else if (normalized.startsWith('nl')) langCode = 'dutch';
        else if (normalized.startsWith('en')) langCode = 'english';
        else if (normalized.startsWith('fi')) langCode = 'finnish';
        else if (normalized.startsWith('fr')) langCode = 'french';
        else if (normalized.startsWith('de')) langCode = 'german';
        else if (normalized.startsWith('el')) langCode = 'greek';
        else if (normalized.startsWith('hi')) langCode = 'hindi';
        else if (normalized.startsWith('hu')) langCode = 'hungarian';
        else if (normalized.startsWith('id')) langCode = 'indonesian';
        else if (normalized.startsWith('ga')) langCode = 'irish';
        else if (normalized.startsWith('it')) langCode = 'italian';
        else if (normalized.startsWith('ne')) langCode = 'nepali';
        else if (normalized.startsWith('no')) langCode = 'norwegian';
        else if (normalized.startsWith('pt')) langCode = 'portuguese';
        else if (normalized.startsWith('ro')) langCode = 'romanian';
        else if (normalized.startsWith('ru')) langCode = 'russian';
        else if (normalized.startsWith('sa')) langCode = 'sanskrit';
        else if (normalized.startsWith('sr')) langCode = 'serbian';
        else if (normalized.startsWith('sl')) langCode = 'slovenian';
        else if (normalized.startsWith('es')) langCode = 'spanish';
        else if (normalized.startsWith('sv')) langCode = 'swedish';
        else if (normalized.startsWith('ta')) langCode = 'tamil';
        else if (normalized.startsWith('tr')) langCode = 'turkish';
        else if (normalized.startsWith('uk')) langCode = 'ukrainian';

        // Japanese/Chinese special handling if needed, but 'chinese' is now supported.
        // Japanese often requires tokenizer, no stopwords for now.
        if (normalized.startsWith('ja')) return [];

        // Dynamic import to avoid bundling all languages
        // Note: ESBuild might bundle them if path is static, but dynamic string makes it tricky.
        // For simplicity and safety with the installed package, let's try a direct map if possible,
        // or just use the english default + extensive map if we want to be fancy.
        // Given the constraints, we'll try to import the specific one.
        // Since we can't easily do dynamic template string imports in all bundlers without config:

        switch (langCode) {
            case 'arabic': return (await import('@orama/stopwords/arabic') as StopWordsModule).stopwords;
            case 'armenian': return (await import('@orama/stopwords/armenian') as StopWordsModule).stopwords;
            case 'bulgarian': return (await import('@orama/stopwords/bulgarian') as StopWordsModule).stopwords;
            case 'chinese': return (await import('@orama/stopwords/chinese') as StopWordsModule).stopwords;
            case 'danish': return (await import('@orama/stopwords/danish') as StopWordsModule).stopwords;
            case 'dutch': return (await import('@orama/stopwords/dutch') as StopWordsModule).stopwords;
            case 'english': return (await import('@orama/stopwords/english') as StopWordsModule).stopwords;
            case 'finnish': return (await import('@orama/stopwords/finnish') as StopWordsModule).stopwords;
            case 'french': return (await import('@orama/stopwords/french') as StopWordsModule).stopwords;
            case 'german': return (await import('@orama/stopwords/german') as StopWordsModule).stopwords;
            case 'greek': return (await import('@orama/stopwords/greek') as StopWordsModule).stopwords;
            case 'hindi': return (await import('@orama/stopwords/hindi') as StopWordsModule).stopwords;
            case 'hungarian': return (await import('@orama/stopwords/hungarian') as StopWordsModule).stopwords;
            case 'indonesian': return (await import('@orama/stopwords/indonesian') as StopWordsModule).stopwords;
            case 'irish': return (await import('@orama/stopwords/irish') as StopWordsModule).stopwords;
            case 'italian': return (await import('@orama/stopwords/italian') as StopWordsModule).stopwords;
            case 'nepali': return (await import('@orama/stopwords/nepali') as StopWordsModule).stopwords;
            case 'norwegian': return (await import('@orama/stopwords/norwegian') as StopWordsModule).stopwords;
            case 'portuguese': return (await import('@orama/stopwords/portuguese') as StopWordsModule).stopwords;
            case 'romanian': return (await import('@orama/stopwords/romanian') as StopWordsModule).stopwords;
            case 'russian': return (await import('@orama/stopwords/russian') as StopWordsModule).stopwords;
            case 'sanskrit': return (await import('@orama/stopwords/sanskrit') as StopWordsModule).stopwords;
            case 'serbian': return (await import('@orama/stopwords/serbian') as StopWordsModule).stopwords;
            case 'slovenian': return (await import('@orama/stopwords/slovenian') as StopWordsModule).stopwords;
            case 'spanish': return (await import('@orama/stopwords/spanish') as StopWordsModule).stopwords;
            case 'swedish': return (await import('@orama/stopwords/swedish') as StopWordsModule).stopwords;
            case 'tamil': return (await import('@orama/stopwords/tamil') as StopWordsModule).stopwords;
            case 'turkish': return (await import('@orama/stopwords/turkish') as StopWordsModule).stopwords;
            case 'ukrainian': return (await import('@orama/stopwords/ukrainian') as StopWordsModule).stopwords;

            default:
                return (await import('@orama/stopwords/english') as StopWordsModule).stopwords;
        }
    } catch (e) {
        workerLogger.warn(`Failed to load stop words for ${language}, defaulting to empty.`, e);
        return [];
    }
}

// Log Stopword filtering
function stripStopWords(query: string): string {
    if (currentStopWords.length === 0) return query;
    const tokens = query.toLowerCase().split(/\s+/);
    const filtered = tokens.filter(t => !currentStopWords.includes(t));
    const result = filtered.length > 0 ? filtered.join(' ') : query;
    workerLogger.debug(`[stripStopWords] Query: "${query}" -> "${result}" (Removed: ${tokens.length - filtered.length})`);
    return result;
}



interface OramaDocument {
    [key: string]: string | number | boolean | number[] | undefined | string[];
    author?: string; // New: Explicit author field
    content: string;
    // New Metadata
    created: number;
    embedding?: number[];
    links?: string[];
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
const LATENCY_BUDGET_TOKENS = WORKER_LATENCY_CONSTANTS.LATENCY_BUDGET_TOKENS;

function calculateInheritedScore(parentScore: number, linkCount: number): number {
    const dilution = Math.max(1, Math.log2(linkCount + 1));
    return parentScore * (0.8 / dilution);
}

// Helper to estimate tokens (approx 4 chars per token)
function estimateTokens(text: string): number {
    return text.length / 4;
}

// fileFilter removed (unused)
const workerLogger = {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[VaultIntelligence:DEBUG] [IndexerWorker] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[VaultIntelligence:ERROR] [IndexerWorker] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:INFO] [IndexerWorker] ${msg}`, ...args), // Obsidian convention
    warn: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:WARN] [IndexerWorker] ${msg}`, ...args)
};

const IndexerWorker: WorkerAPI = {
    /**
     * Constructs the priority payload for the Dual-Loop architecture.
     * 1. Wide Vector Fetch
     * 2. Graph Expansion (with Hub Dilution)
     * 3. Backpack Selection (Budgeting)
     * 4. Batch Hydration (fixing I/O)
     */
    async buildPriorityPayload(queryVector: number[], query: string): Promise<unknown[]> {
        // 1. Parallel Wide Fetch (Top 100 Vector + 50 Keyword)
        const vectorPromise = search(orama, {
            includeVectors: false,
            limit: 100,
            mode: 'vector',
            vector: {
                property: 'embedding',
                value: queryVector
            }
        });

        const keywordPromise = search(orama, {
            includeVectors: false,
            limit: 50,
            properties: ['content', 'title'],
            term: stripStopWords(query), // Use stripped query for keyword search
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE // Use permissive threshold to maximize Recall for the Analyst re-ranker
        });

        const [vectorResults, keywordResults] = await Promise.all([vectorPromise, keywordPromise]);

        const candidates = new Map<string, { id: string; score: number; type: 'vector' | 'graph'; source?: string; content?: string }>();

        // 2a. Process Vector Hits
        for (const hit of vectorResults.hits) {
            const doc = hit.document as unknown as OramaDocument;
            const docId = hit.id;

            if (!candidates.has(docId)) {
                candidates.set(docId, {
                    content: doc.content,
                    id: docId,
                    score: hit.score,
                    type: 'vector'
                });
            }
            // ... Graph neighbors logic will handle expansion for these too
        }

        // 2b. Process Keyword Hits (Merge)
        for (const hit of keywordResults.hits) {
            const doc = hit.document as unknown as OramaDocument;
            const docId = hit.id;

            // If already exists (from vector), keep the higher score? 
            // Vector scores are cosine (0-1ish), Keyword BM25 (>0).
            // Orama vector scores are cosine similarity.
            // We'll prioritize Vector hits as the "primary" reason, but ensure Keyword hits are included.
            if (!candidates.has(docId)) {
                candidates.set(docId, {
                    content: doc.content,
                    id: docId,
                    score: hit.score, // Use keyword score directly
                    type: 'vector' // Treat as direct retrieval
                });
            }
        }

        // 2c. Graph Expansion (Neighbors) - Apply to ALL candidates (Vector + Keyword)
        // We iterate current candidates to expand.
        const seeds = Array.from(candidates.values()); // Snapshot

        for (const seed of seeds) {
            const seedId = seed.id.split('#')[0] || seed.id;
            const path = workerNormalizePath(seedId); // Extract file path from chunk ID

            if (graph.hasNode(path)) {
                const neighbors = graph.neighbors(path);
                const degree = graph.degree(path);

                for (const neighbor of neighbors) {
                    const inherited = calculateInheritedScore(seed.score, degree);
                    // Check if neighbor is just another chunk of the same file?
                    // Graph nodes are files. We inject the *file path* as a candidate ID for hydration.
                    const neighborId = neighbor;

                    if (!candidates.has(neighborId) || candidates.get(neighborId)!.score < inherited) {
                        candidates.set(neighborId, {
                            id: neighborId,
                            score: inherited,
                            source: path,
                            type: 'graph'
                        });
                    }
                }
            }
        }

        // 3. Sort Candidates
        const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);

        interface PayloadItem {
            content?: string;
            id: string;
            score: number;
            source?: string;
            type: 'vector' | 'graph';
        }

        // 4. Backpack Selection (Budgeting)
        const payload: PayloadItem[] = [];
        let currentTokens = 0;
        const idsToHydrate: string[] = [];

        for (const candidate of sorted) {
            if (currentTokens >= LATENCY_BUDGET_TOKENS) break;

            if (candidate.type === 'vector' && candidate.content) {
                // Already have content
                const tokens = estimateTokens(candidate.content);
                if (currentTokens + tokens <= LATENCY_BUDGET_TOKENS) {
                    payload.push({
                        content: candidate.content,
                        id: candidate.id,
                        score: candidate.score,
                        type: 'vector'
                    });
                    currentTokens += tokens;
                }
            } else {
                // Needs hydration (Graph neighbor OR raw file path candidate)
                const EST_TOKENS = 200;
                if (currentTokens + EST_TOKENS <= LATENCY_BUDGET_TOKENS) {
                    idsToHydrate.push(candidate.id);
                    payload.push({
                        id: candidate.id,
                        score: candidate.score,
                        source: candidate.source,
                        type: candidate.type
                    });
                    currentTokens += EST_TOKENS;
                }
            }
        }

        // 5. Batch Hydration
        // We need to fetch content for `idsToHydrate`.
        if (idsToHydrate.length > 0) {
            const { search } = await import('@orama/orama');
            const hydrationResults = await search(orama, {
                limit: idsToHydrate.length * 2,
                where: {
                    path: { in: idsToHydrate }
                }
            });

            // Map results back to payload
            const hydrationMap = new Map<string, string>();
            for (const hit of hydrationResults.hits) {
                const doc = hit.document as unknown as OramaDocument;
                // If ID is chunk-0, user that. If request was for full file (graph neighbor), prefer chunk-0.
                if (String(hit.id).endsWith('#chunk-0')) {
                    hydrationMap.set(doc.path, doc.content);
                }
                // Handle direct chunk request if needed?
                hydrationMap.set(hit.id, doc.content);
            }

            // Fill placeholders
            for (const item of payload) {
                if (!item.content) {
                    // Try exact ID match first, then path match
                    let content = hydrationMap.get(item.id);
                    if (!content && !item.id.includes('#')) {
                        content = hydrationMap.get(item.id); // Try direct path
                    }

                    if (content) {
                        item.content = content;
                    } else {
                        item.content = "(Content unavailable)";
                    }
                }
            }
        }

        // 6. Merge & Clean (YAML Stripping)
        return payload
            .filter(p => p.content && p.content !== "(Content unavailable)")
            .map(p => {
                const { body } = splitFrontmatter(p.content || "");
                return {
                    content: body.trim(),
                    id: p.id,
                    score: p.score,
                    type: p.type
                };
            });
    },

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
        const normalizedPath = workerNormalizePath(path);
        if (graph.hasNode(normalizedPath)) {
            graph.dropNode(normalizedPath);
        }
        try {
            // Updated: Delete all chunks for this path
            const { remove, search } = await import('@orama/orama');
            const chunks = await search(orama, {
                limit: 1000,
                where: { path: { eq: normalizedPath } }
            });

            const ids = chunks.hits.map(h => h.id);
            if (ids.length > 0) {
                for (const id of ids) {
                    await remove(orama, id);
                }
            }
        } catch (e) {
            workerLogger.warn(`Failed to remove ${normalizedPath} from Orama:`, e);
        }
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

            // STRICT FILTER: Only return nodes that actually exist and have content.
            // checking mtime > 0 and size > 0 ensures it's a real file that has been processed.
            // This excludes tags, labels, and ghost topics.
            if (!attr.mtime || !attr.size || attr.type !== 'file') continue;

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

                        // STRICT FILTER: Only return real files as siblings
                        if (!attr.mtime || !attr.size || attr.type !== 'file') continue;

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

        // Load stop words
        currentStopWords = await loadStopWords(conf.agentLanguage);
        workerLogger.info(`Loaded ${currentStopWords.length} stop words for ${conf.agentLanguage}`);

        return true;
    },

    /**
     * Performs a keyword search on the Orama index.
     * Uses Max-Pooling to return unique files.
     */
    async keywordSearch(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const results = await search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_KEYWORD, // Overshoot
            properties: ['title', 'content', 'params', 'status'],
            term: stripStopWords(query),
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE,
            tolerance: WORKER_INDEXER_CONSTANTS.KEYWORD_TOLERANCE
        });

        // Hybrid Boost: If we have an embedding, we should conceptually merge, 
        // but `keywordSearch` signature is text-only. 
        // For true Hybrid here, we would need to run vector search too and merge.
        // Current architecture separates them in `buildPriorityPayload` but uses `keywordSearch` for simple tools using just text.
        // Let's Upgrade `keywordSearch` to be Hybrid if we can cheaply generate an embedding, 
        // OR just leave it as improved Keyword search (which is now better due to stop words).

        // Per User Request: "Switch to Hybrid Search".
        // Since `keywordSearch` is used by tools that might expect purely text match, 
        // strictly speaking `keywordSearch` should remain keyword. 
        // However, `buildPriorityPayload` (used by the Dual Loop) ALREADY implements Hybrid (Lines 75-94).
        // The User's specific issue was likely with `vault_search` tool which calls `graphService.search`.
        // `GraphService.search` calls `worker.search` (Vector) or `worker.keywordSearch`?
        // Let's check `GraphService.ts` in the next step to see which method `vault_search` uses.
        // If it uses `search` (line 691), it is PURE VECTOR.
        // WE NEED TO UPGRADE `search` (line 691) TO BE HYBRID.

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

        if (parsed.graph) {
            graph.import(parsed.graph);
            workerLogger.info(`[loadIndex] Graph loaded with ${graph.order} nodes.`);
        }

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
     * Removes nodes from the graph and Orama that are not in the provided list of valid paths.
     * @param validPaths - Array of current vault file paths.
     */
    async pruneOrphans(validPaths: string[]) {
        const validSet = new Set(validPaths.map(p => workerNormalizePath(p)));
        const orphans: string[] = [];
        graph.forEachNode((node, attr) => {
            const a = attr as GraphNodeData;
            if (a.type === 'file' && !validSet.has(node)) {
                orphans.push(node);
            }
        });

        if (orphans.length > 0) {
            workerLogger.info(`[pruneOrphans] Found ${orphans.length} orphan nodes. Cleaning up...`);
            for (const orphan of orphans) {
                // deleteFile handles Orama chunk removal as well
                await IndexerWorker.deleteFile(orphan);
            }
        }
    },

    /**
     * Handles file renames by updating the graph node ID and Orama index.
     */
    async renameFile(oldPath: string, newPath: string) {
        const normalizedOld = workerNormalizePath(oldPath);
        const normalizedNew = workerNormalizePath(newPath);

        if (graph.hasNode(normalizedOld)) {
            const attr = graph.getNodeAttributes(normalizedOld);
            graph.dropNode(normalizedOld);
            graph.addNode(normalizedNew, { ...(attr as GraphNodeData), path: normalizedNew });
        }
        // Query-Delete old chunks
        await IndexerWorker.deleteFile(normalizedOld);
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

        workerLogger.info(`[saveIndex] Saving index: ${graph.order} nodes, Orama state exported.`);
        workerLogger.info(`[saveIndex] Model: ${config.embeddingModel}, Dimension: ${config.embeddingDimension}`);
        return encode(serialized, { maxDepth: GRAPH_CONSTANTS.MAX_SERIALIZATION_DEPTH });
    },

    /**
     * Performs a vector search on the Orama index.
     * Uses Max-Pooling.
     */
    async search(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        // HYBRID SEARCH UPGRADE
        // 1. Vector Search
        const vectorPromise = search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_VECTOR, // Higher limit for pooling
            mode: 'vector',
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT, // 0.001 - We want ALL vector candidates for re-ranking
            vector: {
                property: 'embedding',
                value: await generateEmbedding(query, 'Query')
            }
        });

        // 2. Keyword Search (for specific terms like "cats")
        const keywordPromise = search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_KEYWORD,
            properties: ['title', 'content', 'params', 'status'],
            term: stripStopWords(query), // Clean query
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE,
            tolerance: WORKER_INDEXER_CONSTANTS.KEYWORD_TOLERANCE
        });

        const [vectorResults, keywordResults] = await Promise.all([vectorPromise, keywordPromise]);

        workerLogger.debug(`[search] Vector Hits: ${vectorResults.hits.length}, Keyword Hits: ${keywordResults.hits.length}`);
        workerLogger.debug(`[search] Threshold: ${JSON.stringify(WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE)}`);

        // 3. Merge Strategies
        const hits = new Map<string, OramaHit>();

        // Add Vector Hits (Base Score: 0-1)
        for (const hit of vectorResults.hits) {
            hits.set(hit.id, hit as unknown as OramaHit);
        }

        // Calculate Max Keyword Score for Local Normalization
        let maxKeywordScore = 0;
        if (keywordResults.hits.length > 0) {
            for (const h of keywordResults.hits) {
                if (h.score > maxKeywordScore) maxKeywordScore = h.score;
            }
        }
        const keywordNormFactor = Math.max(1.0, maxKeywordScore);

        workerLogger.debug(`[search] Keyword Max Score: ${maxKeywordScore} -> Norm Factor: ${keywordNormFactor}`);

        // Add Keyword Hits (Boost if exists, append if not)
        for (const hit of keywordResults.hits) {
            const h = hit as unknown as OramaHit;
            const normalizedScore = h.score / keywordNormFactor; // Scale to 0-1

            if (hits.has(h.id)) {
                // Boost existing vector hit
                const existing = hits.get(h.id)!;
                // Hybrid: Vector + (Normalized Keyword * 0.5)
                // Result can go up to ~1.5 (normalized later globally)
                existing.score += (normalizedScore * 0.5);
            } else {
                // Keyword only match
                // We give it the normalized score (0-1) scaled slightly down to favor hybrids
                h.score = normalizedScore * 0.9;
                hits.set(h.id, h);
            }
        }


        // Convert back to array
        const mergedHits = Array.from(hits.values());

        return maxPoolResults(mergedHits, limit, config.minSimilarityScore ?? 0);
    },

    /**
     * Performs a vector search restricted to specific paths.
     */
    async searchInPaths(query: string, paths: string[], limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const normalizedPaths = paths.map(p => workerNormalizePath(p));
        const results = await search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_VECTOR,
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

        // Reload stop words if language changed
        if (newConfig.agentLanguage && newConfig.agentLanguage !== config.agentLanguage) {
            currentStopWords = await loadStopWords(newConfig.agentLanguage);
            workerLogger.info(`Reloaded ${currentStopWords.length} stop words for ${newConfig.agentLanguage}`);
        }

        await Promise.resolve();
    },

    /**
     * Updates a file in both Orama (content/vector) and Graphology (links).
     * Chunking Strategy Implemented Here.
     */
    async updateFile(path: string, content: string, mtime: number, size: number, title: string, links: string[] = []) {
        const normalizedPath = workerNormalizePath(path);
        const hash = await computeHash(content);

        // Architectural Fix: Delete old data BEFORE adding new node/edges
        // This prevents the "delete-after-add" bug where we dropped the node we just created.
        await IndexerWorker.deleteFile(normalizedPath);

        // 1. Graphology Update
        updateGraphNode(normalizedPath, content, mtime, size, title, hash);
        updateGraphEdges(normalizedPath, content);

        if (content.trim().length === 0) return;

        // 3. Prepare Context
        // NEW: Sanitize Content (Excalidraw)
        const cleanlyContent = sanitizeExcalidrawContent(content);

        const { body, frontmatter } = splitFrontmatter(cleanlyContent);
        const parsedFrontmatter = parseYaml(frontmatter);
        const contextString = generateContextString(title, parsedFrontmatter, config);

        // 4. Split
        const tokensPerChunk = WORKER_INDEXER_CONSTANTS.DEFAULT_CHUNK_TOKENS;
        const charsPerToken = SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE || 4;
        const chunkSize = tokensPerChunk * charsPerToken;
        const overlap = Math.floor(chunkSize * WORKER_INDEXER_CONSTANTS.DEFAULT_OVERLAP_RATIO);

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
                links: links,
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

    const finalHits = Array.from(uniqueHits.values());

    // 2. Compute Global Max Score for Normalization
    let maxScore = 0;
    for (const h of finalHits) {
        if (h.score > maxScore) maxScore = h.score;
    }

    // 3. Normalize (Scale 0 to 1 based on Max)
    // Use Math.max(1.0, maxScore) to prevent upscaling small scores (e.g., max 0.6 staying 0.6)
    // while scaling down huge scores (e.g., max 2.6 becoming 1.0)
    const normalizationFactor = Math.max(1.0, maxScore);
    workerLogger.debug(`[maxPoolResults] Max Score: ${maxScore}, Factor: ${normalizationFactor}, Hits: ${finalHits.length}`);

    return finalHits
        .map(h => ({ ...h, score: h.score / normalizationFactor }))
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
    const MAX_CONTEXT_CHARS = 1000;

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

    // Clean WikiLinks: [[Page|Alias]] -> Alias, [[Page]] -> Page
    let clean = value.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');

    // STRIP QUOTES: Properties often come in as '"Value"' or "'Value'"
    // This ensures "Agentic AI" and Agentic AI resolve to the same node.
    clean = clean.replace(/^["'](.+)["']$/, '$1');

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
    const { body, frontmatter: fmString } = splitFrontmatter(content);
    const fm = parseYaml(fmString);
    const dir = path.split('/').slice(0, -1).join('/');

    // 1. Explicit Link Extraction (Wikilinks / Markdown links)
    const bodyLinks = extractLinks(body);
    const fmLinks = extractLinks(fmString);
    const allExplicitLinks = new Set([...bodyLinks, ...fmLinks]);

    for (const link of allExplicitLinks) {
        const resolvedPath = resolvePath(link, aliasMap, dir);
        if (!graph.hasNode(resolvedPath)) {
            // Tag detection for virtual nodes
            const type = resolvedPath.startsWith('#') ? 'tag' : 'topic';
            graph.addNode(resolvedPath, { mtime: 0, path: resolvedPath, size: 0, type });
        }
        if (graph.hasEdge(path, resolvedPath)) continue;

        const isFM = fmLinks.includes(link);
        graph.addEdge(path, resolvedPath, {
            source: isFM ? 'frontmatter' : 'body',
            type: 'link',
            weight: isFM ? ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER : ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.BODY
        });
    }

    // 2. Semantic Property Link Extraction (topics, tags, topic, tags_list, author)
    // These might be plain text that should resolve to ontology notes.
    const propertyKeys = config.contextAwareHeaderProperties || ['topics', 'tags', 'topic', 'tags_list', 'author'];
    for (const key of propertyKeys) {
        const val = fm[key];
        if (!val) continue;

        const items = ensureArray(val);
        for (const rawItem of items) {
            if (typeof rawItem !== 'string') continue;

            // Sanitize: "[[Topic]]" -> "Topic", "Topic|Alias" -> "Topic"
            const item = sanitizeProperty(rawItem);
            if (!item || item.length === 0) continue;

            const resolvedPath = resolvePath(item, aliasMap, dir);

            // DEBUG: Trace resolution
            if (item.toLowerCase().includes('agentic') || item.toLowerCase().includes('cat')) {
                console.debug(`[IndexerWorker] Resolved semantic link: "${item}" -> "${resolvedPath}" (via ${key} in ${path})`);
            }

            // Check if we already have this edge via explicit links
            if (!graph.hasNode(resolvedPath)) {
                graph.addNode(resolvedPath, { mtime: 0, path: resolvedPath, size: 0, type: 'file' });
            }
            if (graph.hasEdge(path, resolvedPath)) continue;

            graph.addEdge(path, resolvedPath, {
                source: 'frontmatter-property',
                type: 'link',
                weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER
            });
        }
    }
}

async function recreateOrama() {
    const { create } = await import('@orama/orama');
    const language = getOramaLanguage(config.agentLanguage || 'english');

    workerLogger.debug(`[recreateOrama] Creating index with language: ${language} (Raw: ${config.agentLanguage})`);

    orama = create({
        language: language,
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
