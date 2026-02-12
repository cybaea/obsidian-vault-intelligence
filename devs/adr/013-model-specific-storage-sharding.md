# ADR 013: Model-specific storage sharding and token tracking

**Date**: 2026-02-12
**Status**: Accepted

## Context

The Vault Intelligence plugin supports multiple embedding providers (Local, Gemini) and models with varying output dimensions (eg 384, 768, 1536). Historically, the graph state and vector indices were stored in a single `graph-state.msgpack` and a unified IndexedDB store.

This created three critical issues:

1.  **Data corruption**: Switching models of different dimensions would cause OGA (Orama) or vector operations to crash when attempting to load vectors of the wrong shape.
2.  **Lack of isolation**: Users switching between local and cloud models would lose their previous index state if dimensions matched but model logic differed, or experience crashes if dimensions mismatched.
3.  **Heuristic budgets**: Context assembly relied on character-count heuristics (`chars / 4`) which led to suboptimal prompt density or unexpected context window overflows.

## Decision

We will implement a sharded storage architecture and native token tracking across all services.

### 1. Model-specific sharding

-   **Sharded paths**: `PersistenceManager` will compute a unique hash for each model configuration (Provider + Model ID + Dimension).
-   **Filesystem**: The graph state will be saved to `graph-state-<model-hash>.msgpack`.
-   **IndexedDB isolation**:
    -   The Orama docs store (Worker thread) will be namespaced using `orama_index_<model-hash>`.
    -   The persistence buffer (Main thread) will use `orama_index_buffer_<model-hash>`.
    -   This prevents "split-brain" collisions between threads during serialization.
-   **Migration safety**: A graceful migration path will detect legacy `graph-state.msgpack` files, inspect their internal metadata (correctly destructuring top-level model IDs to prevent data loss), and rename them to the correct sharded path on first boot.

### 2. Native token tracking

-   **API integration**: `GeminiService` will extract `usageMetadata` (prompt + candidate counts) from every response and return it to callers.
-   **Local tokenization**: `LocalEmbeddingService` will return the actual token count produced by the Transformers.js tokenizer.
-   **RAG propagation**: `GraphSearchResult` and `VaultSearchResult` will include an optional `tokenCount`.
-   **Budget management**: `ContextAssembler` will use these verified token counts for context packing, falling back to `SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE` only for un-indexed or legacy documents.

### 3. Storage lifecycle management

-   **UI controls**: A dedicated "Storage" settings tab will allow users to:
    -   View active storage shards and their status.
    -   Prune inactive shards (cleaning up disk space for unused models).
    -   Perform a full purge/reset of all plugin data.
-   **Configuration changes**: Changing settings such as `embeddingChunkSize` will trigger a forced re-index (`scanAll(true)`) even if the model ID remains the same, ensuring the index reflects the latest configuration.

## Consequences

### Positive

-   **Stability**: Eliminates all "Dimension Mismatch" crashes during model switching.
-   **UX**: Users can jump between Local and Gemini providers without re-indexing every time.
-   **Precision**: RAG context is now perfectly sized to the LLM's window, improving reasoning quality.
-   **Transparency**: Users have visibility into and control over the plugin's storage footprint.

### Negative

-   **Disk space**: Maintaining multiple shards increases the total disk usage if many models are tested.
-   **Complexity**: `PersistenceManager` and `GraphService` must now coordinate shard-specific initialization.
