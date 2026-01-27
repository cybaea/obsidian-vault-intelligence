/**
 * Core type definitions for the Shadow Graph infrastructure.
 */

export type NodeType = 'file' | 'topic' | 'concept' | 'person';
export type EdgeType = 'link' | 'semantic';

/**
 * Data stored in each graph node.
 */
export interface GraphNodeData {
    path: string;
    type: NodeType;
    mtime: number;
    size: number;
    hash?: string;
    title?: string;
    headers?: string[]; // Extracted H1/H2/H3 for structural context
    tags?: string[];
    [key: string]: unknown; // Allow for extensibility
}

/**
 * Metadata for graph edges.
 */
export interface GraphEdgeData {
    type: EdgeType;
    weight: number; // 0.0 to 1.0
    source?: 'frontmatter' | 'body';
}

/**
 * Search results from the Shadow Graph.
 */
export interface GraphSearchResult {
    path: string;
    score: number;
    title?: string;
    excerpt?: string;
}

/**
 * Configuration passed to the Indexer Worker.
 */
export interface WorkerConfig {
    googleApiKey: string;
    embeddingModel: string;
    embeddingDimension: number;
    chatModel: string;
    indexingDelayMs: number;
    minSimilarityScore: number;
    ontologyPath: string;
}

/**
 * Type-safe API exposed by the indexer worker via Comlink.
 */
export interface WorkerAPI {
    initialize(config: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<number[]>): Promise<void>;
    updateFile(path: string, content: string, mtime: number, size: number, title: string): Promise<void>;
    getFileStates(): Promise<Record<string, { mtime: number, hash: string }>>;
    deleteFile(path: string): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    search(query: string, limit?: number): Promise<GraphSearchResult[]>;
    keywordSearch(query: string, limit?: number): Promise<GraphSearchResult[]>;
    searchInPaths(query: string, paths: string[], limit?: number): Promise<GraphSearchResult[]>;
    getSimilar(path: string, limit?: number): Promise<GraphSearchResult[]>;
    getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<GraphSearchResult[]>;
    getCentrality(path: string): Promise<number>;
    getBatchCentrality(paths: string[]): Promise<Record<string, number>>;
    getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string, headers?: string[] }>>;
    updateAliasMap(map: Record<string, string>): Promise<void>;
    saveIndex(): Promise<Uint8Array>; // Returns serialized graph/index
    loadIndex(data: string | Uint8Array): Promise<void>;
    updateConfig(config: Partial<WorkerConfig>): Promise<void>;
    clearIndex(): Promise<void>;
    fullReset(): Promise<void>;
}
