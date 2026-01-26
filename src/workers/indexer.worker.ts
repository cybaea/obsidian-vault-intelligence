import * as Comlink from 'comlink';
import Graph from 'graphology';
import { search, type AnyOrama, type RawData } from '@orama/orama';
import { WorkerAPI, WorkerConfig, GraphNodeData, GraphSearchResult } from '../types/graph';
import { WORKER_INDEXER_CONSTANTS, ONTOLOGY_CONSTANTS } from '../constants';
import { maskObject } from '../utils/masking';

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
    async initialize(conf: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<number[]>) {
        config = conf;
        graph = new Graph();
        if (typeof embedder === 'function') embedderProxy = embedder;

        // Initialize Orama with vector support
        await recreateOrama();
        await Promise.resolve();

        workerLogger.info(`Initialized Orama with ${conf.embeddingDimension} dimensions and ${conf.embeddingModel}`);
    },

    async updateAliasMap(map: Record<string, string>) {
        await Promise.resolve();
        // Clear and reload alias map from main thread source of truth
        aliasMap.clear();
        for (const [alias, path] of Object.entries(map)) {
            aliasMap.set(alias.toLowerCase(), workerNormalizePath(path));
        }
        workerLogger.debug(`Updated alias map with ${aliasMap.size} entries.`);
    },

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
        // (Only for non-empty files that should have Orama presence)
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
            workerLogger.debug(`Skipping Orama indexing for empty/whitespace-only file: ${normalizedPath} (len: ${content.length}, trimmed: ${trimmedLength})`);
            // Still update graph node for connectivity
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
            // Update existing node
            graph.updateNodeAttributes(normalizedPath, (oldAttr: unknown) => ({
                ...(oldAttr as GraphNodeData),
                mtime,
                size,
                hash,
                title
            }));
        } else {
            // New node
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
        // Split frontmatter vs body to detect link types
        const { frontmatter, body } = splitFrontmatter(content);

        const fmLinks = extractLinks(frontmatter);
        const bodyLinks = extractLinks(body);

        // Add explicit structural edges (Frontmatter)
        for (const link of fmLinks) {
            const resolvedPath = resolvePath(link);
            if (!graph.hasNode(resolvedPath)) {
                graph.addNode(resolvedPath, { path: resolvedPath, type: 'file', mtime: 0, size: 0 });
            }
            // FIX: STRICT IDEMPOTENCY
            // If the edge already exists, skip it. Frontmatter is processed first,
            // so we don't need to worry about overwriting body links here.
            // Duplicate frontmatter links are simply skipped.
            if (graph.hasEdge(normalizedPath, resolvedPath)) {
                continue;
            }

            graph.addEdge(normalizedPath, resolvedPath, {
                type: 'link',
                weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.FRONTMATTER,
                source: 'frontmatter'
            });
        }

        // Add associative edges (Body)
        for (const link of bodyLinks) {
            const resolvedPath = resolvePath(link);
            if (!graph.hasNode(resolvedPath)) {
                graph.addNode(resolvedPath, { path: resolvedPath, type: 'file', mtime: 0, size: 0 });
            }
            // FIX: STRICT IDEMPOTENCY
            // If the edge already exists (whether from frontmatter OR a previous body link), skip it.
            // This prevents "UsageGraphError: edge already exists" crashes on duplicate links.
            if (graph.hasEdge(normalizedPath, resolvedPath)) {
                continue;
            }

            graph.addEdge(normalizedPath, resolvedPath, {
                type: 'link',
                weight: ONTOLOGY_CONSTANTS.EDGE_WEIGHTS.BODY,
                source: 'body'
            });
        }

        try {
            workerLogger.debug(`Generating embedding for ${normalizedPath}...`);
            const embedding = await generateEmbedding(content, title);
            workerLogger.debug(`Generated ${embedding.length} dimensions for ${normalizedPath}`);

            if (embedding.length !== config.embeddingDimension) {
                workerLogger.error(`Dimension mismatch for ${normalizedPath}: expected ${config.embeddingDimension}, got ${embedding.length}`);
                return;
            }

            // Use normalizedPath as the internal Orama ID for upsert support
            const { upsert } = await import('@orama/orama');
            await upsert(orama, {
                id: normalizedPath,
                path: normalizedPath,
                title,
                content: content.slice(0, WORKER_INDEXER_CONSTANTS.CONTENT_PREVIEW_LENGTH),
                embedding
            });

            workerLogger.debug(`Indexed ${normalizedPath} (${embedding.length} dims)`);
        } catch (error) {
            const msg = String(error);
            // Critical errors that should stop the indexing process
            if (msg.includes("API key") || msg.includes("400") || msg.includes("401")) {
                throw error;
            }
            workerLogger.error(`Failed to index ${normalizedPath}:`, error);
        }
    },

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

    async renameFile(oldPath: string, newPath: string) {
        if (graph.hasNode(oldPath)) {
            const attr = graph.getNodeAttributes(oldPath);
            graph.dropNode(oldPath);
            graph.addNode(newPath, { ...(attr as GraphNodeData), path: newPath });
        }
        try {
            const { remove } = await import('@orama/orama');
            await remove(orama, oldPath);
            // newPath will be indexed by subsequent updateFile call usually triggered by rename event
        } catch (e) {
            workerLogger.warn(`Failed to remove ${oldPath} from Orama during rename:`, e);
        }
        return Promise.resolve();
    },

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

    async getSimilar(path: string, limit: number = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEFAULT): Promise<GraphSearchResult[]> {
        if (!orama) return [];
        const normalizedPath = workerNormalizePath(path);

        workerLogger.debug(`Similarity request for: ${normalizedPath}`);

        // 1. Get the embedding for the given path
        const docResult = await search(orama, {
            where: {
                path: { eq: normalizedPath }
            },
            limit: 1,
            includeVectors: true
        });

        const firstHit = docResult.hits[0];
        if (!firstHit) {
            const { count } = await import('@orama/orama');
            const total = count(orama);
            workerLogger.warn(`Similarity lookup failed. Document not indexed: ${normalizedPath} (Total index size: ${total})`);
            return [];
        }

        if (!firstHit.document.embedding) {
            workerLogger.warn(`Document found but has no embedding: ${normalizedPath}`);
            return [];
        }

        const embedding = firstHit.document.embedding as number[];
        if (embedding.length === 0) {
            workerLogger.warn(`Document has empty embedding vector: ${normalizedPath}`);
            return [];
        }

        workerLogger.debug(`Similarity vector size for ${normalizedPath}: ${embedding.length}`);

        // 2. Search for similar vectors, excluding the current path
        const searchLimit = WORKER_INDEXER_CONSTANTS.SEARCH_LIMIT_DEEP;

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
            limit: searchLimit
        } as Parameters<typeof search>[1]);

        const minScore = config.minSimilarityScore ?? 0;
        workerLogger.debug(`Orama raw hits: ${results.hits.length}. Filtering with minScore: ${minScore}`);

        const uniqueHits = new Map<string, GraphSearchResult>();

        for (const hit of results.hits) {
            workerLogger.debug(`Hit: ${hit.id}, score: ${hit.score}`);
            if (hit.score < minScore) continue;

            const doc = hit.document as OramaDocument;
            const docPath = doc.path;

            // If we already have this path with a higher or equal score, skip
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

        const finalResults = Array.from(uniqueHits.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        workerLogger.info(`Found ${finalResults.length} unique similar notes for ${normalizedPath} (from ${results.hits.length} raw hits)`);

        return finalResults;
    },

    async getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology' }): Promise<GraphSearchResult[]> {
        await Promise.resolve();
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return [];

        const direction = options?.direction || 'both';
        const mode = options?.mode || 'simple';

        // Helper to get 1-hop
        const getOneHop = (node: string, dir: 'both' | 'inbound' | 'outbound') => {
            if (dir === 'outbound') return graph.outNeighbors(node);
            if (dir === 'inbound') return graph.inNeighbors(node);
            return graph.neighbors(node);
        };

        const initialNeighbors = getOneHop(normalizedPath, direction);
        const results = new Map<string, GraphSearchResult>();

        // 1. Add direct neighbors
        for (const neighbor of initialNeighbors) {
            const attr = graph.getNodeAttributes(neighbor) as GraphNodeData;
            results.set(neighbor, {
                path: neighbor,
                score: 1.0,
                title: attr.title || neighbor.split('/').pop()?.replace('.md', ''),
                excerpt: ""
            });
        }

        // 2. Ontology Expansion (Topic -> Sibling)
        if (mode === 'ontology') {
            // Logic: For each neighbor that is a "Topic", find ITS inbound neighbors (my siblings)
            for (const neighbor of initialNeighbors) {
                // A node is a Topic if: in Ontology folder (+/- trailing slash) OR high degree
                // Helper to normalize config path for comparison
                const configuredOntology = workerNormalizePath(config.ontologyPath || 'Ontology');
                const isOntologyPath = neighbor.startsWith(configuredOntology + '/');
                const degree = graph.inDegree(neighbor);
                const isHub = degree >= ONTOLOGY_CONSTANTS.HUB_MIN_DEGREE;

                if (isOntologyPath || isHub) {
                    // It's a Topic/Hub. Get its connected nodes (Siblings)
                    // Usually we want nodes that LINK TO this topic => Inbound neighbors of the topic
                    const siblings = graph.inNeighbors(neighbor);

                    for (const sibling of siblings) {
                        if (sibling === normalizedPath) continue; // Don't add self
                        if (results.has(sibling)) continue; // Already found

                        // Calculate Hub Penalty
                        let score = ONTOLOGY_CONSTANTS.SIBLING_DECAY;
                        if (ONTOLOGY_CONSTANTS.HUB_PENALTY_ENABLED) {
                            // Penalize if the shared parent is a massive hub (like a Daily Note)
                            // Score = Base / log10(Degree + 1)
                            // e.g. Degree 10 -> / 1.04. Degree 100 -> / 2. Degree 1000 -> / 3.
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

    async getCentrality(path: string): Promise<number> {
        await Promise.resolve();
        const normalizedPath = workerNormalizePath(path);
        if (!graph.hasNode(normalizedPath)) return 0;

        // Use simple degree centrality as a fallback for structural importance
        // normalized by graph size to stay in 0.0 - 1.0 range (roughly)
        const degree = graph.degree(normalizedPath);
        const totalNodes = graph.order;
        return totalNodes > 1 ? degree / (totalNodes - 1) : 0;
    },

    async saveIndex(): Promise<string> {
        const { save, count } = await import('@orama/orama');
        const total = count(orama);
        workerLogger.debug(`Saving Index: ${graph.order} nodes, ${total} Orama docs`);
        const serialized = {
            graph: graph.export(),
            orama: save(orama),
            embeddingDimension: config.embeddingDimension,
            embeddingModel: config.embeddingModel // Strict model tracking
        };
        return JSON.stringify(serialized);
    },

    async loadIndex(data: string) {
        const { load, count } = await import('@orama/orama');
        const parsed = JSON.parse(data) as SerializedIndexState;

        // Clean slate for graph
        graph.clear();

        // Load Graphology
        if (parsed.graph) {
            graph.import(parsed.graph);
        }

        // Load Orama
        if (parsed.orama) {
            const loadedDimension = parsed.embeddingDimension;
            const expectedDimension = config.embeddingDimension;
            const loadedModel = parsed.embeddingModel;
            const expectedModel = config.embeddingModel;

            workerLogger.debug(`Validating index state. Dims: ${loadedDimension}/${expectedDimension}, Model: ${loadedModel}/${expectedModel}`);

            const modelMismatch = loadedModel !== undefined && loadedModel !== expectedModel;
            const dimMismatch = loadedDimension !== undefined && loadedDimension !== expectedDimension;

            if (modelMismatch || dimMismatch || loadedDimension === undefined) {
                const reason = modelMismatch ? `Model mismatch (${loadedModel} !== ${expectedModel})` :
                    (dimMismatch ? `Dimension mismatch (${loadedDimension} !== ${expectedDimension})` : 'Missing metadata');

                workerLogger.warn(`Orama State Incompatible: ${reason}. Resetting index.`);
                await recreateOrama();
            } else {
                const oramaInternal = parsed.orama;
                // We use a cast to match the internal structure during serialization bridge
                load(orama, oramaInternal as unknown as RawData);
                const total = count(orama);
                workerLogger.debug(`Loaded Index: ${graph.order} nodes, ${total} Orama docs`);

                // BLOCKING Migration: Clean up stale entries with random IDs or missing embeddings
                const { remove, search } = await import('@orama/orama');
                const allDocs = await search(orama, {
                    limit: total,
                    includeVectors: true
                });

                let removedCount = 0;
                let docsWithEmbeddings = 0;
                for (const hit of allDocs.hits) {
                    const doc = hit.document as unknown as OramaDocument;
                    if (doc.embedding) docsWithEmbeddings++;

                    // If the ID is not the same as the path, or if embedding is missing, it's stale/bad
                    if (hit.id !== doc.path || !doc.embedding) {
                        workerLogger.debug(`Migration: removing stale/incomplete entry: id=${hit.id}, path=${doc.path}, hasEmbedding=${!!doc.embedding}`);
                        await remove(orama, hit.id);
                        removedCount++;
                    }
                }
                workerLogger.info(`Migration: Orama has ${docsWithEmbeddings}/${total} docs with embeddings.`);
                if (removedCount > 0) {
                    workerLogger.info(`Migration: Cleaned up ${removedCount} stale/incomplete entries.`);
                }
            }
        }

        return Promise.resolve();
    },

    async updateConfig(newConfig: Partial<WorkerConfig>) {
        const dimensionChanged = newConfig.embeddingDimension !== undefined && newConfig.embeddingDimension !== config.embeddingDimension;
        const modelChanged = newConfig.embeddingModel !== undefined && newConfig.embeddingModel !== config.embeddingModel;

        config = { ...config, ...newConfig };
        workerLogger.debug(`Worker config updated: ${JSON.stringify(await maskObject(newConfig))}`);

        if (dimensionChanged || modelChanged) {
            workerLogger.info(`Critical config change (Model: ${modelChanged}, Dims: ${dimensionChanged}). Recreating Orama index.`);
            await recreateOrama();
        }

        await Promise.resolve();
    },

    async clearIndex() {
        workerLogger.info("Clearing Orama index.");
        await recreateOrama();
    },

    async fullReset() {
        workerLogger.info("Starting FULL index reset (Graph + Orama).");
        graph.clear();
        await recreateOrama();
    }
};

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
    workerLogger.debug(`Orama index recreated with ${config.embeddingDimension} dimensions.`);
}

function workerNormalizePath(path: string): string {
    if (!path) return '';
    let p = path.replace(/\\/g, '/');
    p = p.replace(/\/+/g, '/');
    p = p.replace(/^\.\//, '');
    p = p.replace(/^\/+/, '');
    p = p.replace(/\/+$/, '');
    return p;
}

function resolvePath(link: string): string {
    const normalizedLink = workerNormalizePath(link);
    // 1. Check alias map
    const aliasResolved = aliasMap.get(normalizedLink.toLowerCase());
    if (aliasResolved) return aliasResolved;

    // 2. Handle potential missing .md extension
    if (!normalizedLink.endsWith('.md')) {
        return normalizedLink + '.md';
    }
    return normalizedLink;
}

async function computeHash(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    // In a real browser worker, use crypto.subtle.digest('SHA-256', msgUint8)
    const hashAsBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashAsBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


function splitFrontmatter(text: string): { frontmatter: string, body: string } {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*([\s\S]*)$/);
    if (match) {
        return { frontmatter: match[1] || "", body: match[2] || "" };
    }
    return { frontmatter: "", body: text };
}

/**
 * Unified link extractor that handles both Obsidian wikilinks [[link]] 
 * and standard Markdown links [text](url).
 */
export function extractLinks(text: string): string[] {
    const links: string[] = [];

    let i = 0;
    const len = text.length;

    while (i < len) {
        const char = text[i];

        // 1. Handle Escapes
        if (char === '\\') {
            i += 2;
            continue;
        }

        // 2. Handle Code (Blocks and Inline)
        if (char === '`') {
            const startBackticks = i;
            while (i < len && text[i] === '`') i++;
            const backtickCount = i - startBackticks;
            const delimiter = '`'.repeat(backtickCount);

            let searchPos = i;
            let found = false;
            while (searchPos < len) {
                const nextDelimiterPos = text.indexOf(delimiter, searchPos);
                if (nextDelimiterPos === -1) break;

                let actualCount = 0;
                let j = nextDelimiterPos;
                while (j < len && text[j] === '`') {
                    j++;
                    actualCount++;
                }

                if (actualCount === backtickCount) {
                    if (backtickCount === 1 && nextDelimiterPos > startBackticks && text[nextDelimiterPos - 1] === '\\') {
                        let backslashCount = 0;
                        let k = nextDelimiterPos - 1;
                        while (k >= startBackticks && text[k] === '\\') {
                            backslashCount++;
                            k--;
                        }
                        if (backslashCount % 2 === 1) {
                            searchPos = j;
                            continue;
                        }
                    }
                    i = j;
                    found = true;
                    break;
                } else {
                    searchPos = j;
                }
            }
            if (found) continue;
            i = startBackticks + backtickCount;
            continue;
        }

        // 3. Look for Links
        if (char === '[') {
            // Case A: Wikilinks [[ ... ]]
            if (text[i + 1] === '[') {
                const start = i + 2;
                const end = text.indexOf(']]', start);

                if (end !== -1) {
                    const rawContent = text.substring(start, end);
                    if (!rawContent.includes('\n')) {
                        const link = rawContent.split('|')[0]?.trim();
                        if (link && link.length > 0) {
                            links.push(link);
                        }
                        i = end + 2;
                        continue;
                    }
                }
            }
            // Case B: Standard Markdown Links [text](url)
            else {
                // Find potential closing bracket ]
                let bracketDepth = 1;
                let j = i + 1;
                while (j < len && bracketDepth > 0) {
                    if (text[j] === '\\') { j += 2; continue; }
                    if (text[j] === '[') bracketDepth++;
                    else if (text[j] === ']') bracketDepth--;
                    j++;
                }

                // If we found a closing bracket, check for (url)
                if (bracketDepth === 0 && text[j] === '(') {
                    const urlStart = j + 1;
                    let parenDepth = 1;
                    let k = urlStart;
                    while (k < len && parenDepth > 0) {
                        if (text[k] === '\\') { k += 2; continue; }
                        if (text[k] === '(') parenDepth++;
                        else if (text[k] === ')') parenDepth--;
                        k++;
                    }

                    if (parenDepth === 0) {
                        const rawUrl = text.substring(urlStart, k - 1).trim();

                        // Clean up the URL
                        // 1. Ignore external links (http, https, mailto)
                        // 2. Strip anchors (#)
                        // 3. Strip leading slash
                        if (rawUrl && !rawUrl.match(/^(https?|mailto):/i)) {
                            let cleanUrl = rawUrl.split('#')[0] || "";
                            cleanUrl = cleanUrl.trim();

                            if (cleanUrl.length > 0) {
                                // If it's a vault-absolute path like /Folder/Note.md, strip the leading /
                                if (cleanUrl.startsWith('/')) {
                                    cleanUrl = cleanUrl.substring(1);
                                }
                                links.push(decodeURIComponent(cleanUrl));
                            }
                        }
                        i = k;
                        continue;
                    }
                }
            }
        }

        i++;
    }

    return links;
}

async function generateEmbedding(text: string, title: string): Promise<number[]> {
    if (!embedderProxy) {
        throw new Error("Embedding proxy not initialized. The indexer worker requires a valid embedding proxy to generate vectors.");
    }

    return await embedderProxy(text, title);
}

if (typeof postMessage !== 'undefined' && typeof addEventListener !== 'undefined') {
    Comlink.expose(IndexerWorker);
}
