export interface IEmbeddingService {
    /**
     * Unique identifier for the model (e.g. "gemini-embedding-001" or "all-MiniLM-L6-v2")
     * Used by VectorStore to detect model changes and trigger re-indexing.
     */
    readonly modelName: string;

    /**
     * The output dimensionality of the vectors (e.g. 768, 384).
     * Used by VectorStore to validate binary buffer compatibility.
     */
    readonly dimensions: number;

    /**
     * Embed a search query.
     * Some models (like Gemini) require specific task types for queries vs documents.
     */
    embedQuery(text: string): Promise<number[]>;

    /**
     * Embed a document for storage.
     * @param text - The full text content to embed.
     * @param title - Optional title to provide additional context to the model.
     */
    embedDocument(text: string, title?: string): Promise<number[]>;
}
