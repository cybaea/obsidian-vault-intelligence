# 10. Systemic Path Resolution (Basename Aliasing)

Date: 2026-02-04

## Status

Accepted

## Context

The plugin's specific graph logic relies on connecting "Topics" (e.g., `[[Agentic AI]]`) to explicit file paths (e.g., `Ontology/Concepts/Agentic AI.md`).

Obsidian allows users to link to files using only their basename (e.g., `[[Agentic AI]]`), even if the file is nested deep in folders. The previous implementation of the `IndexerWorker` was strict about paths, leading to "Ghost Nodes" where `[[Agentic AI]]` created a new, disconnected node instead of linking to the existing `Ontology/Concepts/Agentic AI.md`. This broke the semantic graph siblings logic, as the user's note was linked to the ghost node, while other notes were linked to the real node (or other ghost nodes).

## Decision

We have implemented **Systemic Path Resolution** via the `GraphService`.

1. **Global Alias Map**: The `GraphService` now iterates through **all** markdown files in the vault during the `syncAliases` phase.
2. **Basename Mapping**: Every file's basename (lowercased) is mapped to its full canonical path in the `aliasMap`.
3. **Worker Synchronization**: This map is sent to the `IndexerWorker` and used during the link extraction phase.

## Consequences

### Positive

* **Zero-Config Linking**: Users can use standard Obsidian short-links (`[[Basename]]`) anywhere, and the graph will correctly resolve them to the canonical file.
* **Graph Connectivity**: Eliminates "Ghost Nodes" caused by partial keys. Semantic siblings are now correctly identified because they share the same canonical parent node.
* **Retroactive Fix**: Works for all existing notes without requiring manual updates or "fixer" scripts.

### Negative

* **Basename Collisions**: If a user has two files with the same basename in different folders (e.g., `FolderA/Note.md` and `FolderB/Note.md`), the `aliasMap` will only store one of them (last one wins). This is a known Obsidian ambiguity, but for graph strictness, it implies `[[Note]]` might link to the "wrong" one content-wise, though structurally it remains valid. Link resolution priority in `resolvePath` handles relative paths first, then falls back to the alias map.

## Implementation

* **`GraphService.ts`**: Populates the map.
* **`indexer.worker.ts`**: Consumes the map in `updateGraphEdges`.
* **`link-parsing.ts`**: `resolvePath` utilizes the map for normalization.
