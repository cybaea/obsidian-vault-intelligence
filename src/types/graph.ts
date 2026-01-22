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
    tags?: string[];
    [key: string]: unknown; // Allow for extensibility
}

/**
 * Metadata for graph edges.
 */
export interface GraphEdgeData {
    type: EdgeType;
    weight: number; // 0.0 to 1.0
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
}

/**
 * Type-safe API exposed by the indexer worker via Comlink.
 */
export interface WorkerAPI {
    initialize(config: WorkerConfig, fetcher?: unknown, embedder?: (text: string, title: string) => Promise<number[]>): Promise<void>;
    updateFile(path: string, content: string, mtime: number, size: number, title: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    search(query: string, limit?: number): Promise<GraphSearchResult[]>;
    searchInPaths(query: string, paths: string[], limit?: number): Promise<GraphSearchResult[]>;
    getSimilar(path: string, limit?: number): Promise<GraphSearchResult[]>;
    saveIndex(): Promise<string>; // Returns serialized graph/index
    loadIndex(data: string): Promise<void>;
    updateConfig(config: Partial<WorkerConfig>): Promise<void>;
    clearIndex(): Promise<void>;
    fullReset(): Promise<void>;
}
