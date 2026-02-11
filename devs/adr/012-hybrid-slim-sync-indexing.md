# ADR 012: Hybrid Slim-Sync Indexing

## Status

Accepted

## Context

As vaults grow in size, the Orama search index becomes a performance and storage bottleneck. We identified three critical issues with the previous monolithic indexing approach:

1.  **Memory spikes (JSON Bomb)**: Serializing the entire index with full note content using `JSON.stringify` caused massive memory consumption, occasionally leading to worker crashes in extremely large vaults.
2.  **Sync inefficiency**: Binary indices (MessagePack) for large vaults could reach dozens of megabytes. Syncing these across devices (e.g. mobile) via Obsidian Sync or iCloud is slow and consumes significant vault storage.
3.  **Content Drift**: If a binary index is synced but the underlying note content has diverged on another device, the search results (snippets and RAG context) become stale or "amnesiac".

## Decision

We have implemented a **Hybrid Slim-Sync Indexing** strategy that separates search retrieval from content hydration.

### 1. Hot/Cold Storage Split

*   **Hot Store (IndexedDB)**: The primary index storage on the local device. It resides in the browser's IndexedDB and retains the **full** Orama state, including all note content. This ensures maximum performance for local searches.
*   **Cold Store (Vault File)**: The version saved to the `.vault-intelligence` folder for synchronization. Before saving to disk, we perform **Index Slimming**: we iterate through the document store and strip out the actual note content (`content: ""`).

### 2. Main-Thread Hydration

To support the "slim" cold store, we have moved the responsibility of content hydration (fetching the actual text for excerpts and RAG) from the Web Worker to the **Main Thread**.

*   **Logic**: The search orchestrator now returns "hollow" hits (IDs, scores, and offsets).
*   **Action**: The `GraphService` (on the main thread) takes these hollow results and uses Obsidian's `VaultManager` to read the live file content from the disk.
*   **Benefit**: This guarantees that the AI always receives the most up-to-date content for reasoning, even if the index file was synced from a different device state.

### 3. Alpha-Sorted Internal Interfaces

To maintain architectural standards, we have replaced broad `any` usage in the worker's serialization logic with strictly typed internal interfaces for Orama's raw data structures.

## Consequences

*   **Storage**: Index file size in the vault is reduced by ~90% for content-heavy vaults.
*   **Reliability**: RAG context is now immune to index-content drift, as it always pulls from the source file.
*   **Performance**: Slight increase in search latency (ms) due to main-thread I/O during hydration. This is offset by the elimination of worker memory pressure and faster plugin startup times.
*   **Complexity**: Developers must ensure that any new search tools or views correctly call the hydration logic on the main thread rather than assuming the worker returns full content.
