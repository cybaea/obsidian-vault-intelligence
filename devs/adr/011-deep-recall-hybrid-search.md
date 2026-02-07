# ADR 011: Deep Recall Hybrid Search

## Status

Accepted

## Context

The previous hybrid search implementation suffered from two critical issues:

1.  **Vector Starvation**: In mixed result sets, high-scoring keyword matches (BM25) often overshadowed vector results. When combined with a strict global normalization, vector matches were "flattened" and subsequently filtered out by the Context Assembler, leading to zero-context answers for conceptual queries (e.g., "stories about cats" failed if "stories" wasn't a keyword).
2.  **Premature Optimization**: The Orama vector search used a default `similarity` threshold of `0.8`. This was too strict for our GARS (Graph-Augmented Relevance Score) re-ranking strategy, which relies on having a broad candidate pool to apply graph centrality and activation logic.
3.  **Embedding Misalignment**: We were treating Query embeddings identical to Document embeddings, ignoring the specific training objectives of modern models (like Gemini) which distinguish between `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT`.

## Decision

We have overhauled the search pipeline to prioritize **Recall** at the retrieval stage and **Precision** at the ranking/filtering stage.

### 1. Deep Vector Recall

*   **Change**: We now explicitly set the Orama vector search `similarity` threshold to `0.001` (effectively "get everything").
*   **Reasoning**: We trust our internal re-ranking logic (GARS) more than the raw cosine similarity cutoff. By fetching _all_ semantic candidates, we ensure that graph-connected but loose semantic matches (siblings, neighbors) are initially considered.

### 2. Local Keyword Normalization

*   **Change**: Instead of normalizing scores globally at the very end, we now normalize keyword (BM25) scores **locally** within the worker batch before merging.
*   **Logic**: `normalizedScore = rawScore / max(batchMax, 1.0)`.
*   **Benefit**: This scales keyword results to a `0-1` range compatible with vector scores without destroying their relative ranking. It prevents unbounded BM25 scores from mathematically dominating the hybrid addition.

### 3. Asymmetric Embedding

*   **Change**: The `GraphService` now detects if an embedding request is for a 'Query' and passes the correct task type to the embedding provider.
*   **Benefit**: Aligns with the underlying model's trained manifold, effectively rotating the query vector to better match document vectors in the latent space.

### 4. Fuzzy Search Tolerance

*   **Change**: Keyword search now enables Levenshtein distance matching (`tolerance: 2`).
*   **Benefit**: Improves robust recall for typos and morphological variations, critical for natural language queries.

### 5. Post-Retrieval Filtering

*   **Change**: `SearchOrchestrator` now explicitly filters the _merged_ results against the user's configured `minSimilarityScore`.
*   **Benefit**: While the _Worker_ fetches everything (for graph analysis), the _User_ only sees high-quality matches. This decoupling allows complex background graph scoring without flooding the UI with low-relevance noise.

## Consequences

*   **Performance**: Slight increase in IPC traffic between Worker and Main thread due to larger initial candidate pools. Mitigated by `maxPoolResults` limits.
*   **Complexity**: The search pipeline is now split into "Retrieval" (Permissive) and "Presentation" (Strict) phases, requiring developers to look at two places to understand why a result appears or doesn't.
*   **Quality**: Significantly improved recall for "near-miss" conceptual queries and greater robustness against typos.
