# ADR-009: Background indexing and metadata management

## Status

Accepted

## Context

Indexing a large vault for semantic search and graph analysis is a computationally expensive task. Performing these operations on the main thread leads to UI "jank" and a poor user experience, especially during large vault imports or frequent edits. Furthermore, managing metadata (frontmatter) across many files concurrently introduces the risk of race conditions and data loss if not handled systematically.

## Decision

We offloaded all heavy indexing tasks to a dedicated Web Worker and centralized all frontmatter modifications into a specific management service.

1.  **Indexer Worker**: The `indexer.worker.ts` maintains two core data structures:
    *   **Orama Index**: A fast, local vector database for semantic search.
    *   **Relationship Graph**: A `graphology` instance that tracks wikilinks and file metadata.
2.  **Background Processing**: The `GraphService` (main thread) debounces file system events and offloads the heavy work (hashing, parsing, and indexing) to the worker via Comlink.
3.  **Embedding Proxy**: Since the worker cannot directly access cloud APIs or heavy ONNX models, it calls back to the main thread's `IEmbeddingService` via a proxy to generate vectors.
4.  **Metadata Manager**: The `MetadataManager` service provides a safe, centralized API for updating frontmatter. It uses Obsidian's `processFrontMatter` to ensure that file writes are atomic and handle potential concurrency issues.

## Consequences

### Positive

*   **Smooth UI**: User interactions remain responsive even while thousands of notes are being indexed in the background.
*   **Rich retrieval**: Maintaining a formal graph allows for sophisticated "context discovery" beyond simple vector similarity.
*   **Data integrity**: Centralizing frontmatter updates reduces the risk of corrupting user notes during automated operations (like Gardner applications).
*   **Persistence**: The worker's state is periodically serialized to the vault, allowing for fast plugin restarts without re-generating embeddings.

### Negative

*   **Serialization overhead**: Transferring large amounts of data between the main thread and the worker can introduce some latency.
*   **Architectural complexity**: Requires handling worker lifecycle, error recovery, and complex "callback" patterns for embedding generation.
