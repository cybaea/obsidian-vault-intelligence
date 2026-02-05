/**
 * Core type definitions for the Shadow Graph infrastructure.
 */

export type NodeType = 'file' | 'topic' | 'concept' | 'person';
export type EdgeType = 'link' | 'semantic';

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
 * Search results from the Shadow Graph.
 */
export interface GraphSearchResult {
    excerpt?: string;
    path: string;
    score: number;
    title?: string;
}

/**
 * Configuration passed to the Indexer Worker.
 */
export interface WorkerConfig {
    agentLanguage: string;
    authorName: string;
    chatModel: string;
    contextAwareHeaderProperties: string[];
    embeddingDimension: number;
    embeddingModel: string;
    googleApiKey: string;
    indexingDelayMs: number;
    minSimilarityScore: number;
    ontologyPath: string;
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
    getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string, headers?: string[] }>>;
    getCentrality(path: string): Promise<number>;
    getFileStates(): Promise<Record<string, { mtime: number, hash: string }>>;
    getNeighbors(path: string, options?: { direction?: 'both' | 'inbound' | 'outbound'; mode?: 'simple' | 'ontology'; decay?: number }): Promise<GraphSearchResult[]>;
    getSimilar(path: string, limit?: number): Promise<GraphSearchResult[]>;
    initialize(config: WorkerConfig, fetcher: unknown, embedder: unknown): Promise<boolean>;
    keywordSearch(query: string, limit?: number): Promise<GraphSearchResult[]>;
    loadIndex(data: string | Uint8Array): Promise<boolean>;
    pruneOrphans(paths: string[]): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    saveIndex(): Promise<Uint8Array>; // Returns serialized graph/index
    search(query: string, limit?: number): Promise<GraphSearchResult[]>;
    searchInPaths(query: string, paths: string[], limit?: number): Promise<GraphSearchResult[]>;
    updateAliasMap(map: Record<string, string>): Promise<void>;
    updateConfig(config: Partial<WorkerConfig>): Promise<void>;
    updateFile(path: string, content: string, mtime: number, size: number, title: string, links?: string[]): Promise<void>;
}
