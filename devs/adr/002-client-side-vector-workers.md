# ADR-002: Client-Side Vector Store via Web Workers

## Status

Accepted

## Context

Obsidian plugins run in the main Renderer process (Electron). Blocking the main thread for more than 50ms causes UI lag.
Indexing a vault (generating embeddings + inserting into a vector tree) is computationally expensive.

* Initial approach using main-thread processing caused the app to freeze for seconds/minutes on large vaults.
* Mobile devices (iOS/Android) are even more sensitive to main thread blocking.

## Decision

We moved the entire Vector Store and Graph Indexing logic to a **Web Worker** (`indexer.worker.ts`), communicating via `Comlink`.

* **Library Choice**: We selected **Orama** (formerly Lyra) because it is written in pure TypeScript, has zero native dependencies (vital for Obsidian Mobile), and supports vector search out of the box.
* **Architecture**: The `GraphService` acts as a proxy. The actual "State" (the Orama index and Graphology graph) lives inside the Worker's memory.
* **Persistence**: The Worker serializes the index to JSON, passes it to the main thread, which saves it to `data/graph-state.json`.

## Consequences

### Positive

* **Non-Blocking UI**: Indexing happens silently in the background. The user can type while the agent thinks.
* **Mobile Support**: Works entirely on iPad/Android since it uses standard Web APIs (no Node native modules).

### Negative

* **"Split Brain" Risk**: The Worker has the "truth", but the Main thread has the "File System". If the worker crashes or persistence fails, they de-sync.
* **Serialization Overhead**: Passing large strings (file content) and vectors between threads has a serialization cost. We check file hashes to minimize this.
* **Complexity**: Debugging Web Workers in Obsidian is difficult. `console.log` messages have to be proxied back to the main thread.
* **Memory Usage**: The Worker duplicates some data (the index) that might already exist in Obsidian's metadata cache, increasing RAM footprint.
