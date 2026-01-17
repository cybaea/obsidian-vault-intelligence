import * as Comlink from 'comlink';
import Graph from 'graphology';
import { create, search, type AnyOrama, type RawData } from '@orama/orama';
import { WorkerAPI, WorkerConfig, GraphNodeData, GraphSearchResult } from '../types/graph';

let graph: Graph;
let orama: AnyOrama;
let config: WorkerConfig;
let fetchProxy: ((url: string, options: unknown) => Promise<unknown>) | null = null;
let embedderProxy: ((text: string, title: string) => Promise<number[]>) | null = null;

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
    async initialize(conf: WorkerConfig, fetcher?: unknown, embedder?: unknown) {
        config = conf;
        graph = new Graph();
        if (typeof fetcher === 'function') fetchProxy = fetcher as (url: string, options: unknown) => Promise<unknown>;
        if (typeof embedder === 'function') embedderProxy = embedder as (text: string, title: string) => Promise<number[]>;

        // Initialize Orama with vector support
        const oramaInstance = create({
            schema: {
                path: 'enum',
                title: 'string',
                content: 'string',
                embedding: `vector[${conf.embeddingDimension}]`
            }
        });
        orama = oramaInstance;
        await Promise.resolve();

        workerLogger.info(`Initialized Orama with ${conf.embeddingDimension} dimensions and ${conf.embeddingModel}`);
    },

    async updateFile(path: string, content: string, mtime: number, size: number, title: string) {
        // 1. Hash check
        const hash = await computeHash(content);
        let forceReindex = false;

        const { getByID } = await import('@orama/orama');
        const existingOramaDoc = getByID(orama, path) as unknown as OramaDocument | undefined;

        // Force re-index if not in Orama OR missing embedding OR dimension mismatch
        if (!existingOramaDoc || !existingOramaDoc.embedding || existingOramaDoc.embedding.length !== config.embeddingDimension) {
            forceReindex = true;
            const reason = !existingOramaDoc ? 'Missing from Orama' :
                (!existingOramaDoc.embedding ? 'Missing embedding' :
                    `Dimension mismatch (${existingOramaDoc.embedding.length} !== ${config.embeddingDimension})`);
            workerLogger.debug(`Forcing re-index for ${path}: ${reason}`);
        }

        // 1b. Empty content guard
        const trimmedLength = content.trim().length;
        if (trimmedLength === 0) {
            workerLogger.debug(`Skipping Orama indexing for empty/whitespace-only file: ${path} (len: ${content.length}, trimmed: ${trimmedLength})`);
            // Still update graph node for connectivity
            if (graph.hasNode(path)) {
                graph.updateNodeAttributes(path, (oldAttr: unknown) => ({
                    ...(oldAttr as GraphNodeData),
                    mtime,
                    size,
                    hash,
                    title
                }));
            } else {
                graph.addNode(path, { path, type: 'file', mtime, size, hash, title });
            }
            return;
        }

        if (graph.hasNode(path)) {
            const attr = graph.getNodeAttributes(path) as GraphNodeData;
            if (attr.hash === hash && !forceReindex) {
                return; // Unchanged and already in Orama
            }
            // Update existing node
            graph.updateNodeAttributes(path, (oldAttr: unknown) => ({
                ...(oldAttr as GraphNodeData),
                mtime,
                size,
                hash,
                title
            }));
        } else {
            // New node
            graph.addNode(path, {
                path,
                type: 'file',
                mtime,
                size,
                hash,
                title
            });
        }

        // 2. Parse Wikilinks -> Add Explicit Edges
        const links = parseWikilinks(content);
        for (const link of links) {
            if (!graph.hasNode(link)) {
                // Add placeholder for missing files if needed
                graph.addNode(link, { path: link, type: 'file', mtime: 0, size: 0 });
            }
            if (!graph.hasEdge(path, link)) {
                graph.addEdge(path, link, { type: 'link', weight: 1.0 });
            }
        }

        try {
            workerLogger.debug(`Generating embedding for ${path}...`);
            const embedding = await generateEmbedding(content, title);
            workerLogger.debug(`Generated ${embedding.length} dimensions for ${path}`);

            if (embedding.length !== config.embeddingDimension) {
                workerLogger.error(`Dimension mismatch for ${path}: expected ${config.embeddingDimension}, got ${embedding.length}`);
                return;
            }

            // Use path as the internal Orama ID for upsert support
            const { upsert } = await import('@orama/orama');
            await upsert(orama, {
                id: path,
                path,
                title,
                content: content.slice(0, 500),
                embedding
            });

            workerLogger.debug(`Indexed ${path} (${embedding.length} dims)`);
        } catch (error) {
            workerLogger.error(`Failed to index ${path}:`, error);
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

    async search(query: string, limit: number = 5): Promise<GraphSearchResult[]> {
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

    async getSimilar(path: string, limit: number = 5): Promise<GraphSearchResult[]> {
        if (!orama) return [];

        workerLogger.debug(`Similarity request for: ${path}`);

        // 1. Get the embedding for the given path
        const docResult = await search(orama, {
            where: {
                path: { eq: path }
            },
            limit: 1,
            includeVectors: true
        });

        const firstHit = docResult.hits[0];
        if (!firstHit) {
            const { count } = await import('@orama/orama');
            const total = count(orama);
            workerLogger.warn(`Similarity lookup failed. Document not indexed: ${path} (Total index size: ${total})`);
            return [];
        }

        if (!firstHit.document.embedding) {
            workerLogger.warn(`Document found but has no embedding: ${path}`);
            return [];
        }

        const embedding = firstHit.document.embedding as number[];
        if (embedding.length === 0) {
            workerLogger.warn(`Document has empty embedding vector: ${path}`);
            return [];
        }

        workerLogger.debug(`Similarity vector size for ${path}: ${embedding.length}`);

        // 2. Search for similar vectors, excluding the current path
        // Increase limit significantly to 500 to ensure we find low-score matches if they exist
        const searchLimit = 500;

        const results = await search(orama, {
            mode: 'vector',
            vector: {
                value: embedding,
                property: 'embedding'
            },
            similarity: 0.001, // Small positive threshold to bypass default 0.8
            where: {
                path: { nin: [path] }
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

        workerLogger.info(`Found ${finalResults.length} unique similar notes for ${path} (from ${results.hits.length} raw hits)`);

        return finalResults;
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
        workerLogger.debug(`Worker config updated: ${JSON.stringify(newConfig)}`);

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

async function computeHash(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    // In a real browser worker, use crypto.subtle.digest('SHA-256', msgUint8)
    const hashAsBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashAsBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseWikilinks(text: string): string[] {
    const links: string[] = [];
    const wikiLinkRegex = /\[\[(.*?)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiLinkRegex.exec(text)) !== null) {
        const link = match[1]?.split('|')[0]?.trim();
        if (link) links.push(link);
    }
    return links;
}

async function generateEmbedding(text: string, title: string): Promise<number[]> {
    if (embedderProxy) {
        return await embedderProxy(text, title);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.embeddingModel}:embedContent?key=${config.googleApiKey}`;
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            title: title
        })
    };

    let data: { embedding: { values: number[] } };
    if (fetchProxy) {
        data = await fetchProxy(url, options) as { embedding: { values: number[] } };
    } else {
        throw new Error("Fetch proxy not initialized");
    }

    return data.embedding.values;
}

Comlink.expose(IndexerWorker);
