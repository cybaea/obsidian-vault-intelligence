/**
 * Core type definitions for the Shadow Graph infrastructure.
 * Note: content property added for RAG hydration.
 */

export type NodeType = 'file' | 'topic' | 'concept' | 'person';
export type EdgeType = 'link' | 'semantic';

/**
 * Data for a single file update batch.
 */
export interface FileUpdateData {
    content: string;
    links?: string[];
    mtime: number;
    path: string;
    size: number;
    title: string;
}

/**
 * Data stored in each graph node.
 */
export interface GraphNodeData {
    [key: string]: unknown; // Allow for extensibility
    hash?: string;
    headers?: string[]; // Extracted H1/H2/H3 for structural context
    mtime: number;
    path: string;
    size: number;
    tags?: string[];
    title?: string;
    tokenCount?: number; // New: total tokens for the document
    type: NodeType;
}

/**
 * Metadata for graph edges.
 */
export interface GraphEdgeData {
    source?: 'frontmatter' | 'body';
    type: EdgeType;
    weight: number; // 0.0 to 1.0
}

/**
 * Raw search results from the Shadow Graph (Worker -> Main bridge).
 */
export interface SerializableGraphSearchResult {
    anchorHash?: number;
    description?: string; // Metadata about relationship (e.g. "(Sibling via ...)")
    end?: number;
    excerpt?: string;
    id?: string; // Orama document ID (path#chunk)
    path: string;
    score: number;
    start?: number;
    title?: string;
    tokenCount?: number;
}

/**
 * Search results from the Shadow Graph.
 */
export interface GraphSearchResult extends SerializableGraphSearchResult {
    content?: string; // hold full/chunk text for RAG/hydration
}

/**
 * Configuration passed to the Indexer Worker.
 */
export interface WorkerConfig {
    agentLanguage: string;
    authorName: string;
    chatModel: string;
    contextAwareHeaderProperties: string[];
    embeddingChunkSize: number;
    embeddingDimension: number;
    embeddingModel: string;
    indexingDelayMs: number;
    minSimilarityScore: number;
    ontologyPath: string;
    sanitizedModelId: string;
    semanticGraphNodeLimit: number;
}

/**
 * Type-safe API exposed by the indexer worker via Comlink.
 */
export interface WorkerAPI {
    buildPriorityPayload(queryVector: number[], query: string): Promise<unknown[]>;
    clearIndex(): Promise<void>;
    deleteFile(path: string): Promise<void>;
    fullReset(): Promise<void>;
    getBatchCentrality(paths: string[]): Promise<Record<string, number>>;
    getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string, headers?: string[], tokenCount?: number }>>;
    getCentrality(path: string): Promise<number>;
    getFileState(path: string): Promise<{ mtime: number, size: number, hash: string } | null>;
    getFileStates(): Promise<Record<string, { mtime: number, size: number, hash: string }>>;
    getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<SerializableGraphSearchResult[]>;
    getSimilar(path: string, limit?: number, minScore?: number): Promise<SerializableGraphSearchResult[]>;
    getSubgraph(centerPath: string, updateId: number, existingPositions?: Record<string, { x: number, y: number }>): Promise<unknown>;
    initialize(config: WorkerConfig, fetcher: unknown, embedder: unknown): Promise<boolean>;
    keywordSearch(query: string, limit?: number): Promise<SerializableGraphSearchResult[]>;
    loadIndex(data: string | Uint8Array): Promise<boolean>;
    pruneOrphans(paths: string[]): Promise<void>;
    saveIndex(): Promise<Uint8Array>; // Returns serialized graph/index
    search(query: string, limit?: number): Promise<SerializableGraphSearchResult[]>;
    searchInPaths(query: string, paths: string[], limit?: number): Promise<SerializableGraphSearchResult[]>;
    updateAliasMap(map: Record<string, string>): Promise<void>;
    updateConfig(config: Partial<WorkerConfig>): Promise<void>;
    updateFile(path: string, content: string, mtime: number, size: number, title: string, links?: string[]): Promise<void>;
    updateFiles(files: FileUpdateData[]): Promise<void>;
}
