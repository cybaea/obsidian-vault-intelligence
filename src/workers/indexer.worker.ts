import { decode, encode } from '@msgpack/msgpack';
import { load, search, upsert, type AnyOrama, type RawData } from '@orama/orama';
import * as Comlink from 'comlink';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

import { GRAPH_CONSTANTS, ONTOLOGY_CONSTANTS, SEARCH_CONSTANTS, WORKER_INDEXER_CONSTANTS, WORKER_LATENCY_CONSTANTS } from '../constants';
import { STORES, StorageProvider } from '../services/StorageProvider';
import { type GraphNodeData, type GraphSearchResult, type WorkerAPI, type WorkerConfig, type FileUpdateData } from '../types/graph';
import { resolveEngineLanguage, resolveStopwordKey } from '../utils/language-utils';
import { extractLinks, fastHash, resolvePath, splitFrontmatter, workerNormalizePath } from '../utils/link-parsing';

let graph: Graph;
let orama: AnyOrama;
let config: WorkerConfig;
let embedderProxy: ((text: string, title: string) => Promise<{ vector: number[], tokenCount: number }>) | null = null;
const aliasMap: Map<string, string> = new Map(); // alias lower -> canonical path
let latestGraphUpdateId = 0;
let currentStopWords: string[] = []; // Loaded dynamically
const storage = new StorageProvider();

interface StopWordsModule {
    stopwords: string[];
}

// Helper to normalize language code for Orama engine
function getOramaLanguage(language: string): string {
    return resolveEngineLanguage(language);
}

// Language Normalization & Stop Word Loading
async function loadStopWords(language: string): Promise<string[]> {
    try {
        const langCode = resolveStopwordKey(language);
        switch (langCode) {
            case 'arabic': return (await import('@orama/stopwords/arabic') as StopWordsModule).stopwords;
            case 'armenian': return (await import('@orama/stopwords/armenian') as StopWordsModule).stopwords;
            case 'bulgarian': return (await import('@orama/stopwords/bulgarian') as StopWordsModule).stopwords;
            case 'mandarin': return (await import('@orama/stopwords/mandarin') as StopWordsModule).stopwords;
            case 'danish': return (await import('@orama/stopwords/danish') as StopWordsModule).stopwords;
            case 'dutch': return (await import('@orama/stopwords/dutch') as StopWordsModule).stopwords;
            case 'english': return (await import('@orama/stopwords/english') as StopWordsModule).stopwords;
            case 'finnish': return (await import('@orama/stopwords/finnish') as StopWordsModule).stopwords;
            case 'french': return (await import('@orama/stopwords/french') as StopWordsModule).stopwords;
            case 'german': return (await import('@orama/stopwords/german') as StopWordsModule).stopwords;
            case 'greek': return (await import('@orama/stopwords/greek') as StopWordsModule).stopwords;
            case 'indian': return (await import('@orama/stopwords/indian') as StopWordsModule).stopwords;
            case 'hungarian': return (await import('@orama/stopwords/hungarian') as StopWordsModule).stopwords;
            case 'indonesian': return (await import('@orama/stopwords/indonesian') as StopWordsModule).stopwords;
            case 'irish': return (await import('@orama/stopwords/irish') as StopWordsModule).stopwords;
            case 'italian': return (await import('@orama/stopwords/italian') as StopWordsModule).stopwords;
            case 'japanese': return (await import('@orama/stopwords/japanese') as StopWordsModule).stopwords;
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

function stripStopWords(query: string): string {
    if (currentStopWords.length === 0) return query;
    const tokens = query.toLowerCase().split(/\s+/);
    const filtered = tokens.filter(t => !currentStopWords.includes(t));
    const result = filtered.length > 0 ? filtered.join(' ') : query;
    workerLogger.debug(`[stripStopWords] Query: "${query}" -> "${result}" (Removed: ${tokens.length - filtered.length})`);
    return result;
}

interface OramaDocument {
    anchorHash: number;
    author?: string;
    content: string;
    context: string;
    created: number;
    embedding?: number[];
    end: number;
    id: string;
    links?: string[];
    mtime: number;
    params: string[];
    path: string;
    start: number;
    status: string;
    title: string;
    tokenCount: number;
}

interface OramaHit {
    document: OramaDocument;
    id: string;
    score: number;
}

interface SerializedIndexState {
    embeddingChunkSize?: number;
    embeddingDimension: number;
    embeddingModel: string;
    graph: object;
    orama: RawData;
}

const workerLogger = {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[VaultIntelligence:DEBUG] [IndexerWorker] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[VaultIntelligence:ERROR] [IndexerWorker] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:INFO] [IndexerWorker] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[VaultIntelligence:WARN] [IndexerWorker] ${msg}`, ...args)
};

// 2. Semantic Splitter (Header-Based with Fallback)
function semanticSplit(text: string, maxChunkSize: number = WORKER_INDEXER_CONSTANTS.DEFAULT_MAX_CHUNK_CHARACTERS): Array<{ text: string, start: number, end: number }> {
    const chunks: Array<{ text: string, start: number, end: number }> = [];

    const pushChunk = (t: string, s: number, e: number) => {
        if (!t.trim()) return;
        if (t.length > maxChunkSize) {
            const overlap = Math.floor(maxChunkSize * 0.1);
            const subChunks = recursiveCharacterSplitter(t, maxChunkSize, overlap);

            let subOffset = 0;
            for (const sub of subChunks) {
                // Step back by the overlap (plus a tiny safety buffer) so indexOf catches it
                const searchStart = Math.max(0, subOffset - overlap - 10);
                let actualInSub = t.indexOf(sub, searchStart);

                // Fallback in case of identical repetitive text strings 
                if (actualInSub === -1) actualInSub = subOffset;

                chunks.push({
                    end: s + actualInSub + sub.length,
                    start: s + actualInSub,
                    text: sub,
                });
                subOffset = actualInSub + sub.length;
            }
        } else {
            chunks.push({ end: e, start: s, text: t });
        }
    };

    // Find all header start positions lightning-fast
    // Matches start of string or newline, followed by 1-6 hashes and a space
    const headerRegex = /(?:^|\n)(#{1,6}\s)/g;
    const headerIndices: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = headerRegex.exec(text)) !== null) {
        // If the match starts with \n, the actual header text starts at index + 1
        const actualIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
        headerIndices.push(actualIndex);
    }

    if (headerIndices.length === 0) {
        // No headers found, treat the whole text as one chunk
        pushChunk(text, 0, text.length);
        return chunks;
    }

    // If there's text before the first header, push it as an intro chunk
    if (headerIndices[0]! > 0) {
        pushChunk(text.substring(0, headerIndices[0]), 0, headerIndices[0]!);
    }

    // Iterate through headers and slice the text between them
    let currentChunkText = "";
    let currentChunkStart = -1;

    for (let i = 0; i < headerIndices.length; i++) {
        const startIdx = headerIndices[i]!;
        const endIdx = (i + 1 < headerIndices.length) ? headerIndices[i + 1]! : text.length;
        const sectionText = text.substring(startIdx, endIdx);

        if (currentChunkStart === -1) currentChunkStart = startIdx;

        // If combining this section with the current chunk exceeds max size, push the current chunk
        if (currentChunkText.length > 0 && (currentChunkText.length + sectionText.length) > maxChunkSize) {
            pushChunk(currentChunkText, currentChunkStart, currentChunkStart + currentChunkText.length);
            currentChunkText = sectionText;
            currentChunkStart = startIdx;
        } else {
            currentChunkText += sectionText;
        }
    }

    // Push the final chunk
    if (currentChunkText.length > 0) {
        pushChunk(currentChunkText, currentChunkStart, currentChunkStart + currentChunkText.length);
    }

    return chunks;
}

const IndexerWorker: WorkerAPI = {
    async buildPriorityPayload(queryVector: number[], query: string): Promise<unknown[]> {
        if (!orama) throw new Error("[IndexerWorker] Orama index not initialized");
        if (!config) throw new Error("[IndexerWorker] Configuration not initialized");

        const LATENCY_BUDGET_TOKENS = (config.embeddingChunkSize || 512) * WORKER_LATENCY_CONSTANTS.LATENCY_BUDGET_FACTOR;

        const vectorPromise = search(orama, {
            includeVectors: false,
            limit: 100,
            mode: 'vector',
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            vector: {
                property: 'embedding',
                value: queryVector
            }
        });

        const keywordPromise = search(orama, {
            includeVectors: false,
            limit: 50,
            properties: ['content', 'title', 'context'],
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            term: stripStopWords(query),
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE
        });

        const [vectorResults, keywordResults] = await Promise.all([vectorPromise, keywordPromise]);
        const candidates = new Map<string, { id: string; score: number; type: 'vector' | 'graph'; source?: string; content?: string }>();

        for (const hit of vectorResults.hits) {
            const doc = hit.document as unknown as OramaDocument;
            if (!candidates.has(hit.id)) {
                candidates.set(hit.id, {
                    content: doc.content,
                    id: hit.id,
                    score: hit.score,
                    type: 'vector'
                });
            }
        }

        for (const hit of keywordResults.hits) {
            const doc = hit.document as unknown as OramaDocument;
            if (!candidates.has(hit.id)) {
                candidates.set(hit.id, {
                    content: doc.content,
                    id: hit.id,
                    score: hit.score,
                    type: 'vector'
                });
            }
        }

        const seeds = Array.from(candidates.values());
        for (const seed of seeds) {
            const seedId = seed.id.split('#')[0] || seed.id;
            const path = workerNormalizePath(seedId);

            if (graph.hasNode(path)) {
                const neighbors = graph.neighbors(path);
                const degree = graph.degree(path);

                for (const neighbor of neighbors) {
                    const inherited = calculateInheritedScore(seed.score, degree);
                    const neighborId = neighbor;

                    const existing = candidates.get(neighborId);
                    if (!existing || existing.score < inherited) {
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

        const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);
        const payload: Array<{ content?: string; id: string; score: number; type: 'vector' | 'graph'; source?: string }> = [];
        let currentTokens = 0;
        const idsToHydrate: string[] = [];

        for (const candidate of sorted) {
            if (currentTokens >= LATENCY_BUDGET_TOKENS) break;

            if (candidate.type === 'vector') {
                // Use actual token count from Orama if available, fallback to estimate
                const tokens = (candidate as { tokenCount?: number }).tokenCount || (candidate.content ? estimateTokens(candidate.content) : 128);

                if (currentTokens + tokens <= LATENCY_BUDGET_TOKENS) {
                    payload.push({
                        content: candidate.content || "", // Pass empty string to be hydrated later
                        id: candidate.id,
                        score: candidate.score,
                        type: 'vector'
                    });
                    currentTokens += tokens;
                }
            } else {
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

        if (idsToHydrate.length > 0) {
            const hydrationResults = await search(orama, {
                limit: idsToHydrate.length * 2,
                where: {
                    id: { in: idsToHydrate }
                }
            });

            const hydrationMap = new Map<string, string>();
            for (const hit of hydrationResults.hits) {
                const doc = hit.document as unknown as OramaDocument;
                hydrationMap.set(hit.id, doc.content);
                hydrationMap.set(doc.path, doc.content);
            }

            for (const item of payload) {
                if (!item.content) {
                    let content = hydrationMap.get(item.id);
                    if (!content) {
                        const baseId = item.id.split('#')[0];
                        if (baseId) content = hydrationMap.get(baseId);
                    }
                    item.content = content ?? "(Content unavailable)";
                }
            }
        }

        return payload
            .filter(p => p.type === 'graph' || (p.content !== "(Content unavailable)"))
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

    async clearIndex() {
        await recreateOrama();
    },

    async deleteFile(path: string) {
        const normalizedPath = workerNormalizePath(path);
        if (graph.hasNode(normalizedPath)) {
            graph.dropNode(normalizedPath);
        }
        try {
            const results = await search(orama, {
                limit: 1000,
                where: { path: { eq: normalizedPath } }
            });

            const ids = results.hits.map(h => h.id);
            if (ids.length > 0) {
                const { remove } = await import('@orama/orama');
                for (const id of ids) {
                    await remove(orama, id);
                }
            }
        } catch (e) {
            workerLogger.warn(`Failed to remove ${normalizedPath} from Orama:`, e);
        }
    },

    async fullReset() {
        if (graph) graph.clear();
        await recreateOrama();
        workerLogger.info("Full reset complete.");
    },

    async getBatchCentrality(paths: string[]): Promise<Record<string, number>> {
        if (!graph) throw new Error("[IndexerWorker] Graph not initialized");
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

    async getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string, headers?: string[], tokenCount?: number }>> {
        if (!graph) throw new Error("[IndexerWorker] Graph not initialized");
        await Promise.resolve();
        const results: Record<string, { title?: string, headers?: string[], tokenCount?: number }> = {};
        for (const path of paths) {
            const normalizedPath = workerNormalizePath(path);
            if (graph.hasNode(normalizedPath)) {
                const attr = graph.getNodeAttributes(normalizedPath) as GraphNodeData;
                results[path] = { headers: attr.headers, title: attr.title, tokenCount: attr.tokenCount };
            } else {
                results[path] = {};
            }
        }
        return results;
    },

    async getCentrality(path: string): Promise<number> {
        if (!graph) throw new Error("[IndexerWorker] Graph not initialized");
        await Promise.resolve();
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return 0;
        const degree = graph.degree(normalizedPath);
        const totalNodes = graph.order;
        return totalNodes > 1 ? degree / (totalNodes - 1) : 0;
    },

    async getFileState(path: string) {
        await Promise.resolve();
        const normalized = workerNormalizePath(path);
        if (!graph || !graph.hasNode(normalized)) return null;
        const attr = graph.getNodeAttributes(normalized) as GraphNodeData;
        if (attr.type !== 'file') return null;
        return { hash: attr.hash || '', mtime: attr.mtime, size: attr.size };
    },

    async getFileStates() {
        await Promise.resolve();
        const states: Record<string, { hash: string, mtime: number, size: number }> = {};
        if (graph) {
            graph.forEachNode((node, attr) => {
                const a = attr as GraphNodeData;
                if (a.type === 'file') {
                    states[node] = { hash: a.hash || '', mtime: a.mtime, size: a.size };
                }
            });
        }
        return states;
    },

    async getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<GraphSearchResult[]> {
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return [];

        const direction = options?.direction || 'both';
        const mode = options?.mode || 'simple';

        const getOneHop = (node: string, dir: 'both' | 'inbound' | 'outbound') => {
            if (dir === 'outbound') return graph.outNeighbors(node);
            if (dir === 'inbound') return graph.inNeighbors(node);
            return graph.neighbors(node);
        };

        await Promise.resolve();
        const initialNeighbors = getOneHop(normalizedPath, direction);
        const results = new Map<string, GraphSearchResult>();

        for (const neighbor of initialNeighbors) {
            const attr = graph.getNodeAttributes(neighbor) as GraphNodeData;
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
                        if (sibling === normalizedPath || results.has(sibling)) continue;
                        let score = options?.decay ?? ONTOLOGY_CONSTANTS.SIBLING_DECAY;
                        if (ONTOLOGY_CONSTANTS.HUB_PENALTY_ENABLED) {
                            // Using Math.log (Natural Log) is the Information Retrieval standard (e.g. TF-IDF).
                            // It is ~2.3x more aggressive than log10, effectively suppressed "noisy" hubs 
                            // with 10-15 connections in both small and large vaults.
                            score = score / Math.max(1, Math.log(degree + 1));
                        }
                        const attr = graph.getNodeAttributes(sibling) as GraphNodeData;
                        if (!attr.mtime || !attr.size || attr.type !== 'file') continue;

                        results.set(sibling, {
                            description: `(Sibling via ${neighbor})`,
                            excerpt: undefined,
                            path: sibling,
                            score: score,
                            title: attr.title || sibling.split('/').pop()?.replace('.md', '')
                        } as GraphSearchResult);
                    }
                }
            }
        }
        return Array.from(results.values());
    },

    async getSimilar(path: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT, minScore: number = 0): Promise<GraphSearchResult[]> {
        if (!orama) throw new Error("[IndexerWorker] Orama index not initialized");
        if (!config) throw new Error("[IndexerWorker] Configuration not initialized");
        const normalizedPath = workerNormalizePath(path);

        const docResult = await search(orama, {
            includeVectors: true,
            limit: 100,
            where: { path: { eq: normalizedPath } }
        });

        if (!docResult.hits.length) return [];
        const vectors = docResult.hits.map(h => h.document.embedding as number[]);
        if (vectors.length === 0 || !vectors[0]) return [];

        const dim = vectors[0].length;
        const centroid = new Array(dim).fill(0);
        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) centroid[i] += vec[i];
        }

        let magnitude = 0;
        for (let i = 0; i < dim; i++) {
            centroid[i] = centroid[i] / vectors.length;
            magnitude += centroid[i] * centroid[i];
        }
        magnitude = Math.sqrt(magnitude);

        if (magnitude > 1e-6) {
            for (let i = 0; i < dim; i++) centroid[i] /= magnitude;
        }

        const results = await search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_VECTOR,
            mode: 'vector',
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            vector: { property: 'embedding', value: centroid },
            where: { path: { nin: [normalizedPath] } }
        });

        return maxPoolResults(results.hits as unknown as OramaHit[], limit, minScore);
    },

    async getSubgraph(centerPath: string, updateId: number, existingPositions?: Record<string, { x: number, y: number }>): Promise<unknown> {
        if (!graph || !orama) return null;
        latestGraphUpdateId = updateId;

        const normalizedCenter = workerNormalizePath(centerPath);
        // if (!graph.hasNode(normalizedCenter)) return "";

        const limit = config.semanticGraphNodeLimit || 250;
        const structuralLimit = Math.floor(limit * 0.8);

        // BFS for structural neighbors
        const subgraph = new Graph({ type: 'undirected' });
        const queue: [string, number][] = [[normalizedCenter, 0]];
        const visited = new Set<string>();
        visited.add(normalizedCenter);

        // Helper to add node to subgraph with unified attributes
        const addNodeToSubgraph = (node: string, type: 'center' | 'structural' | 'semantic') => {
            if (subgraph.hasNode(node)) return;
            const attr = graph.hasNode(node) ? graph.getNodeAttributes(node) as GraphNodeData : undefined;
            const pos = existingPositions?.[node];

            subgraph.addNode(node, {
                color: "#ccc", // Placeholder for main thread resolution
                label: attr?.title || node.split('/').pop()?.replace('.md', '') || node,
                nodeType: type,
                size: type === 'center' ? 10 : (type === 'structural' ? 5 : 4),
                // CRITICAL FIX: Seed randomly around (0,0) to prevent FA2 gravity implosions
                // Also ensures NaN positions are never injected into the physics engine
                x: (pos && typeof pos.x === 'number' && !isNaN(pos.x)) ? pos.x : ((Math.random() - 0.5) * 100),
                y: (pos && typeof pos.y === 'number' && !isNaN(pos.y)) ? pos.y : ((Math.random() - 0.5) * 100)
            });
        };

        addNodeToSubgraph(normalizedCenter, 'center');

        if (graph.hasNode(normalizedCenter)) {
            while (queue.length > 0 && subgraph.order < structuralLimit) {
                const [node, depth] = queue.shift()!;
                if (depth >= 2) continue;

                graph.forEachNeighbor(node, (neighbor) => {
                    if (subgraph.order < structuralLimit && !subgraph.hasNode(neighbor)) {
                        addNodeToSubgraph(neighbor, 'structural');
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.push([neighbor, depth + 1]);
                        }
                    }

                    if (subgraph.hasNode(neighbor)) {
                        // Prevent self loops and duplicate edges
                        if (node !== neighbor && !subgraph.hasEdge(node, neighbor)) {
                            subgraph.addEdge(node, neighbor, { edgeType: 'structural', size: 1, type: 'line' });
                        }
                    }
                });
            }
        }

        // Semantic Injection
        const semanticLimit = Math.min(limit - subgraph.order, Math.max(3, Math.floor(limit * 0.10)));
        if (semanticLimit > 0) {
            const similar = await IndexerWorker.getSimilar(centerPath, semanticLimit);
            for (const item of similar) {
                const path = item.path;

                // CRITICAL FIX: Prevent fatal Graphology error by skipping self-loops
                if (path === normalizedCenter) continue;

                if (!subgraph.hasNode(path)) {
                    addNodeToSubgraph(path, 'semantic');
                }

                if (subgraph.hasNode(path)) {
                    if (!subgraph.hasEdge(normalizedCenter, path)) {
                        subgraph.addEdge(normalizedCenter, path, { edgeType: 'semantic', size: 2, type: 'line', zIndex: 1 });
                    } else {
                        // Upgrade existing structural edge so Graphology doesn't throw a collision error
                        const edge = subgraph.edge(normalizedCenter, path) || subgraph.edge(path, normalizedCenter);
                        if (edge) subgraph.mergeEdgeAttributes(edge, { edgeType: 'semantic', size: 2, zIndex: 1 });
                    }
                }
            }
        }

        if (subgraph.order <= 1) return subgraph.export();

        // Layout: Single block execution to preserve physics momentum.
        // For ~250 nodes this executes synchronously in under ~15ms, zero UI thread blocking.
        const maxIterations = Math.min(300, Math.max(100, subgraph.order));
        const layoutSettings = { gravity: 1.5, linLogMode: true, strongGravityMode: true };

        // Abort if stale before starting expensive layout
        if (latestGraphUpdateId !== updateId) {
            workerLogger.debug(`[getSubgraph] Aborting stale layout for ${centerPath}`);
            return null;
        }

        try {
            forceAtlas2.assign(subgraph, { iterations: maxIterations, settings: layoutSettings });
        } catch (e) {
            workerLogger.error(`[getSubgraph] FA2 Layout failed:`, e);
        }

        return subgraph.export();
    },

    async initialize(conf: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<{ vector: number[], tokenCount: number }>) {
        config = conf;
        graph = new Graph();
        if (typeof embedder === 'function') embedderProxy = embedder;

        await recreateOrama();
        currentStopWords = await loadStopWords(conf.agentLanguage);
        workerLogger.info(`Initialized Orama with ${conf.embeddingDimension} dimensions. Loaded ${currentStopWords.length} stopwords.`);

        return true;
    },

    async keywordSearch(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        if (!orama) throw new Error("[IndexerWorker] Orama index not initialized");
        const results = await search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_KEYWORD,
            properties: ['title', 'content', 'context'],
            term: stripStopWords(query),
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE,
            tolerance: WORKER_INDEXER_CONSTANTS.KEYWORD_TOLERANCE
        });
        return maxPoolResults(results.hits as unknown as OramaHit[], limit, 0);
    },

    async loadIndex(data: string | Uint8Array): Promise<boolean> {
        let parsed: SerializedIndexState;
        try {
            if (typeof data === 'string') {
                parsed = JSON.parse(data) as SerializedIndexState;
            } else {
                parsed = decode(data) as SerializedIndexState;
            }
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

            if (loadedModel !== expectedModel || loadedDimension !== expectedDimension) {
                workerLogger.warn(`Index mismatch: ${loadedModel} vs ${expectedModel}`);
                await recreateOrama();
                return false;
            }

            try {
                // Try to load FULL index from Hot Store first!
                let loadedFull = false;
                try {
                    const fullRaw = await storage.get(STORES.VECTORS, `orama_index_${config.sanitizedModelId}`);
                    if (fullRaw) {
                        load(orama, fullRaw as RawData);
                        workerLogger.info("[loadIndex] Restored FULL index from Hot Store.");
                        loadedFull = true;
                    }
                } catch (e) {
                    workerLogger.warn("[loadIndex] Failed to read Hot Store, falling back to SLIM index.", e);
                }

                if (!loadedFull) {
                    workerLogger.info("[loadIndex] Hot Store empty or failed, loading SLIM index.");
                    load(orama, parsed.orama);
                }
            } catch (e) {
                workerLogger.warn("Orama load failed", e);
                return false;
            }
        }
        return true;
    },

    async pruneOrphans(validPaths: string[]) {
        const validSet = new Set(validPaths.map(p => workerNormalizePath(p)));
        const orphans: string[] = [];
        graph.forEachNode((node, attr) => {
            const a = attr as GraphNodeData;
            if (a.type === 'file' && !validSet.has(node)) orphans.push(node);
        });

        for (const orphan of orphans) {
            await IndexerWorker.deleteFile(orphan);
        }
    },

    async saveIndex(): Promise<Uint8Array> {
        const { save } = await import('@orama/orama');

        interface OramaDocsStoreRaw {
            count: number;
            docs: Record<string, Record<string, unknown>>;
        }

        interface OramaRawData {
            docs: OramaDocsStoreRaw;
            index: unknown;
            internalDocumentIDStore: unknown;
            language: string;
            pinning: unknown;
            sorting: unknown;
        }

        const rawFull = (save as (orama: unknown) => OramaRawData)(orama);

        // 1. Save FULL index to "Hot Store" (IndexedDB)
        try {
            await storage.put(STORES.VECTORS, `orama_index_${config.sanitizedModelId}`, rawFull);
            workerLogger.info(`[saveIndex] Hot Store (IDB) updated for ${config.sanitizedModelId}.`);
        } catch (e) {
            workerLogger.warn("[saveIndex] Hot Store update failed:", e);
        }

        // 2. Prepare SLIM index for "Cold Store" (Vault File)
        // We create a SLIM COPY of the documents record to avoid modifying the IDB data in-place
        const slimRaw: OramaRawData = { ...rawFull };

        if (rawFull.docs?.docs) {
            const hollowDocs: Record<string, Record<string, unknown>> = {};
            for (const [id, doc] of Object.entries(rawFull.docs.docs)) {
                hollowDocs[id] = {
                    ...doc,
                    content: "",
                    context: ""
                };
            }
            slimRaw.docs = { ...rawFull.docs, docs: hollowDocs };
        }

        const serialized: SerializedIndexState = {
            embeddingChunkSize: config.embeddingChunkSize,
            embeddingDimension: config.embeddingDimension,
            embeddingModel: config.embeddingModel,
            graph: graph.export(),
            orama: slimRaw as unknown as RawData,
        };

        return encode(serialized, { maxDepth: GRAPH_CONSTANTS.MAX_SERIALIZATION_DEPTH });
    },

    async search(query: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const vectorPromise = search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_VECTOR,
            mode: 'vector',
            similarity: WORKER_INDEXER_CONSTANTS.SIMILARITY_THRESHOLD_STRICT,
            vector: {
                property: 'embedding',
                value: (await generateEmbedding(query, 'Query')).vector
            }
        });

        const keywordPromise = search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_KEYWORD,
            properties: ['title', 'content', 'context'],
            term: stripStopWords(query),
            threshold: WORKER_INDEXER_CONSTANTS.RECALL_THRESHOLD_PERMISSIVE
        });

        const [vectorResults, keywordResults] = await Promise.all([vectorPromise, keywordPromise]);
        const hits = new Map<string, OramaHit>();

        for (const hit of vectorResults.hits) hits.set(hit.id, hit as unknown as OramaHit);

        let maxKS = 0;
        for (const h of keywordResults.hits) if (h.score > maxKS) maxKS = h.score;
        const norm = Math.max(1.0, maxKS);

        for (const hit of keywordResults.hits) {
            const h = hit as unknown as OramaHit;
            const score = h.score / norm;
            if (hits.has(h.id)) {
                const existing = hits.get(h.id);
                if (existing) {
                    existing.score += (score * 0.5);
                }
            } else {
                h.score = score * 0.9;
                hits.set(h.id, h);
            }
        }

        return maxPoolResults(Array.from(hits.values()), limit, config.minSimilarityScore ?? 0);
    },

    async searchInPaths(query: string, paths: string[], limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        const normalizedPaths = paths.map(p => workerNormalizePath(p));
        const results = await search(orama, {
            limit: limit * WORKER_INDEXER_CONSTANTS.SEARCH_OVERSHOOT_FACTOR_VECTOR,
            mode: 'vector',
            vector: {
                property: 'embedding',
                value: (await generateEmbedding(query, 'Query')).vector
            },
            where: { path: { in: normalizedPaths } }
        });
        return maxPoolResults(results.hits as unknown as OramaHit[], limit, config.minSimilarityScore ?? 0);
    },

    async updateAliasMap(map: Record<string, string>) {
        await Promise.resolve();
        aliasMap.clear();
        for (const [alias, path] of Object.entries(map)) {
            aliasMap.set(alias.toLowerCase(), workerNormalizePath(path));
        }
        workerLogger.debug(`Updated alias map: ${aliasMap.size} entries.`);
    },

    async updateConfig(newConfig: Partial<WorkerConfig>) {
        if (!config) throw new Error("[IndexerWorker] Configuration not initialized");
        workerLogger.info("Updating worker configuration.");
        const dimChanged = newConfig.embeddingDimension !== undefined && newConfig.embeddingDimension !== config.embeddingDimension;
        const modelChanged = newConfig.embeddingModel !== undefined && newConfig.embeddingModel !== config.embeddingModel;

        config = { ...config, ...newConfig };
        if (dimChanged || modelChanged) await recreateOrama();

        if (newConfig.agentLanguage && newConfig.agentLanguage !== config.agentLanguage) {
            currentStopWords = await loadStopWords(newConfig.agentLanguage);
        }
    },

    async updateFile(path: string, content: string, mtime: number, size: number, title: string, links: string[] = []) {
        if (!orama) throw new Error("[IndexerWorker] Orama index not initialized");
        if (!graph) throw new Error("[IndexerWorker] Graph not initialized");
        if (!config) throw new Error("[IndexerWorker] Configuration not initialized");

        const normalizedPath = workerNormalizePath(path);
        const hash = await computeHash(content);

        await IndexerWorker.deleteFile(normalizedPath);

        // We update the node initially, but we might patch it with token counts later
        updateGraphNode(normalizedPath, content, mtime, size, title, hash, 0);
        updateGraphEdges(normalizedPath, content);

        if (content.trim().length === 0) return;

        const cleanlyContent = sanitizeExcalidrawContent(content);
        const { body, frontmatter } = splitFrontmatter(cleanlyContent);
        const parsedFM = parseYaml(frontmatter);
        const context = generateContextString(title, parsedFM, config);

        const bodyOffset = cleanlyContent.indexOf(body);
        const chunks = semanticSplit(body, (config.embeddingChunkSize || 512) * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE);

        const batchedDocs: OramaDocument[] = [];
        let totalTokens = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) continue;

            const fullText = (context + "\n" + chunk.text).trim();
            const chunkId = `${normalizedPath}#${i}`;

            if (fullText.length === 0) continue;

            const { tokenCount, vector } = await generateEmbedding(fullText, title);
            totalTokens += tokenCount;

            batchedDocs.push({
                anchorHash: fastHash(chunk.text), // Anchor on the body text, not context
                author: parsedFM.author ? sanitizeProperty(parsedFM.author) : undefined,
                content: chunk.text, // Live index keeps content (pure)
                context: context, // Metadata header
                created: mtime,
                embedding: vector,
                end: chunk.end + bodyOffset,
                id: chunkId,
                mtime: mtime,
                params: [], // Simplified for now
                path: normalizedPath,
                start: chunk.start + bodyOffset,
                status: parsedFM.status ? sanitizeProperty(parsedFM.status) : 'active',
                title: title,
                tokenCount: tokenCount,
            });
        }

        for (const doc of batchedDocs) {
            await upsert(orama, doc);
        }

        // Patch the graph node with the final token count
        updateGraphNode(normalizedPath, content, mtime, size, title, hash, totalTokens);
    },

    async updateFiles(files: FileUpdateData[]) {
        for (const file of files) {
            await IndexerWorker.updateFile(
                file.path,
                file.content,
                file.mtime,
                file.size,
                file.title,
                file.links
            );
        }
    }
};

// --- Helper Functions ---

function calculateInheritedScore(parentScore: number, linkCount: number): number {
    const dilution = Math.max(1, Math.log2(linkCount + 1));
    return parentScore * (0.8 / dilution);
}

function estimateTokens(text: string): number {
    return text.length / SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE;
}

function maxPoolResults(hits: OramaHit[], limit: number, minScore: number): GraphSearchResult[] {
    const uniqueHits = new Map<string, GraphSearchResult>();
    for (const hit of hits) {
        if (hit.score < minScore) continue;
        const doc = hit.document;
        const existing = uniqueHits.get(doc.path);
        if (!existing || hit.score > existing.score) {
            uniqueHits.set(doc.path, {
                anchorHash: doc.anchorHash,
                end: doc.end,
                excerpt: doc.content,
                path: doc.path,
                score: hit.score,
                start: doc.start,
                title: doc.title,
                tokenCount: doc.tokenCount,
            } as GraphSearchResult);
        }
    }

    const finalHits = Array.from(uniqueHits.values());
    let maxS = 0;
    for (const h of finalHits) if (h.score > maxS) maxS = h.score;
    const factor = Math.max(1.0, maxS);

    return finalHits
        .map((h: GraphSearchResult) => ({ ...h, score: h.score / factor }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function recursiveCharacterSplitter(text: string, chunkSize: number, overlap: number): string[] {
    if (text.length <= chunkSize) return [text];
    let finalChunks: string[] = [];
    let currentChunk = "";
    let parts = text.split('\n\n');
    let sep = '\n\n';

    if (parts.some(p => p.length > chunkSize)) {
        parts = text.split('\n');
        sep = '\n';
    }

    for (const part of parts) {
        if ((currentChunk.length + part.length + sep.length) > chunkSize) {
            if (currentChunk.length > 0) {
                finalChunks.push(currentChunk);
                currentChunk = currentChunk.slice(-overlap) + sep + part;
            } else {
                for (let k = 0; k < part.length; k += chunkSize) {
                    finalChunks.push(part.slice(k, k + chunkSize));
                }
                currentChunk = "";
            }
        } else {
            currentChunk += (currentChunk.length > 0 ? sep : "") + part;
        }
    }
    if (currentChunk.length > 0) finalChunks.push(currentChunk);
    return finalChunks;
}

function generateContextString(title: string, fm: Record<string, unknown>, conf: WorkerConfig): string {
    const parts: string[] = [];
    const props = conf.contextAwareHeaderProperties || ['title', 'topics', 'tags', 'type', 'author', 'status'];
    for (const key of props) {
        let val = fm[key];
        if (key === 'title' && !val) val = title;
        if (val) {
            const sanitized = sanitizeProperty(val);
            if (sanitized) parts.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${sanitized}.`);
        }
    }
    return parts.join(' ').substring(0, 1000);
}

function sanitizeProperty(value: unknown): string {
    if (Array.isArray(value)) return value.map(v => sanitizeProperty(v)).join(', ');
    if (typeof value !== 'string') return String(value);
    return value.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').replace(/^["'](.+)["']$/, '$1').trim();
}

function ensureArray(val: unknown): unknown[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
}

function sanitizeExcalidrawContent(content: string): string {
    return content.replace(/```compressed-json[\s\S]*?```/g, '');
}

function updateGraphNode(path: string, content: string, mtime: number, size: number, title: string, hash: string, tokenCount: number) {
    const headers = extractHeaders(content);
    if (!graph.hasNode(path)) {
        graph.addNode(path, { hash, headers, mtime, path, size, title, tokenCount, type: 'file' });
    } else {
        graph.updateNodeAttributes(path, (attr: unknown) => ({ ...(attr as GraphNodeData), hash, headers, mtime, size, title, tokenCount }));
    }
}

function updateGraphEdges(path: string, content: string) {
    const { body, frontmatter } = splitFrontmatter(content);
    const fm = parseYaml(frontmatter);
    const dir = path.split('/').slice(0, -1).join('/');
    const links = new Set([...extractLinks(body), ...extractLinks(frontmatter)]);

    for (const link of links) {
        const resolved = resolvePath(link, aliasMap, dir);
        if (!graph.hasNode(resolved)) graph.addNode(resolved, { mtime: 0, path: resolved, size: 0, type: 'topic' });
        if (!graph.hasEdge(path, resolved)) {
            graph.addEdge(path, resolved, { source: 'body', type: 'link', weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.BODY });
        }
    }

    // Semantic Property Link Extraction
    const propertyKeys = config.contextAwareHeaderProperties || ['topics', 'tags', 'topic', 'tags_list', 'author'];
    for (const key of propertyKeys) {
        const val = fm[key];
        if (!val) continue;

        const items = ensureArray(val);
        for (const rawItem of items) {
            if (typeof rawItem !== 'string') continue;
            const item = sanitizeProperty(rawItem);
            if (!item) continue;

            const resolved = resolvePath(item, aliasMap, dir);
            if (!graph.hasNode(resolved)) graph.addNode(resolved, { mtime: 0, path: resolved, size: 0, type: 'file' });
            if (!graph.hasEdge(path, resolved)) {
                graph.addEdge(path, resolved, {
                    source: 'frontmatter-property',
                    type: 'link',
                    weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER
                });
            }
        }
    }
}

async function recreateOrama() {
    try {
        const { create } = await import('@orama/orama');
        orama = create({
            language: getOramaLanguage(config.agentLanguage || 'english'),
            schema: {
                anchorHash: 'number',
                author: 'string',
                content: 'string',
                context: 'string',
                created: 'number',
                embedding: `vector[${config.embeddingDimension}]`,
                end: 'number',
                id: 'enum',
                mtime: 'number',
                params: 'enum[]',
                path: 'enum',
                start: 'number',
                status: 'enum',
                title: 'string',
                tokenCount: 'number',
            }
        });
    } catch (e) {
        workerLogger.error("Failed to recreate Orama:", e);
    }
}

async function computeHash(text: string): Promise<string> {
    const msg = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', msg);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractHeaders(text: string): string[] {
    return text.split('\n').filter(l => l.match(/^(#{1,3})\s+(.*)$/)).map(l => l.trim());
}

async function generateEmbedding(text: string, title: string): Promise<{ vector: number[], tokenCount: number }> {
    if (!embedderProxy) throw new Error("Embedding proxy not initialized.");
    return embedderProxy(text, title);
}

function parseYaml(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');
    let currentKey: string | null = null;

    for (const line of lines) {
        if (line.trim() === '---' || !line.trim()) continue;
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (listMatch?.[1] && currentKey) {
            const val = listMatch[1].trim();
            const existing = result[currentKey];
            if (Array.isArray(existing)) {
                existing.push(val);
            } else {
                result[currentKey] = [val];
            }
            continue;
        }
        const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (keyMatch?.[1] && keyMatch[2] !== undefined) {
            const key = keyMatch[1];
            let value = keyMatch[2].trim();
            currentKey = key;
            if (value.startsWith('[') && value.endsWith(']')) {
                result[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else if (value) {
                result[key] = value.replace(/^['"]|['"]$/g, '');
            } else {
                result[key] = [];
            }
        }
    }
    return result;
}

if (typeof postMessage !== 'undefined' && typeof addEventListener !== 'undefined') {
    Comlink.expose(IndexerWorker);
}

export default class IndexerWorkerHelper extends Worker {
    constructor() { super('worker'); }
}
