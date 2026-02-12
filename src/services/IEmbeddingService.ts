export type EmbeddingPriority = 'high' | 'low';

export interface IEmbeddingService {
    /**
     * The output dimensionality of the vectors (e.g. 768, 384).
     * Used by VectorStore to validate binary buffer compatibility.
     */
    readonly dimensions: number;

    /**
     * Embed a document for storage.
     * @returns Object containing the chunked vectors and the total token count.
     */
    embedDocument(text: string, title?: string, priority?: EmbeddingPriority): Promise<{ vectors: number[][], tokenCount: number }>;

    /**
     * Embed a search query.
     * @returns Object containing the vector and the token count.
     */
    embedQuery(text: string, priority?: EmbeddingPriority): Promise<{ vector: number[], tokenCount: number }>;

    /**
     * Unique identifier for the model (e.g. "gemini-embedding-001" or "all-MiniLM-L6-v2")
     * Used by VectorStore to detect model changes and trigger re-indexing.
     */
    readonly modelName: string;

    /**
     * Update configuration on the fly (e.g. thread count).
     * This allows the service to adapt to changed settings without a full restart.
     */
    updateConfiguration?(): void;
}
