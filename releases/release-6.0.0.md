# 6.0.0 — The Scale & Slim-Sync Update

Version 6.0.0 is a major architectural update. Building on the improvements in [version 5.2.0](/releases/release-5.2.0), this release focuses on scaling Vault Intelligence to handle large knowledge bases efficiently. We have shrunk the database to support large vaults, introduced a new "Slim-Sync" strategy for mobile, hardened memory persistence, and overhauled state management to ensure the agent maintains context across restarts.

**NOTE**: This release is not database-compatible with previous versions. You will need to re-index your vault.

## Scale: 10,000+ notes

We have re-engineered the core engine to support larger vaults. By implementing model sharding and optimizing memory usage during indexing, the plugin remains stable even with vaults exceeding 10,000 notes. The new architecture ensures that the agent's performance scales linearly with your vault size.

## Slim-Sync: Mobile-ready intelligence

The new "Slim-Sync" architecture addresses mobile storage constraints. By separating the searchable index into "Hot" (active metadata) and "Cold" (full content) layers, we have reduced the disk footprint of the search index by approximately 90%.

This allows you to sync plugin data across devices using Obsidian Sync or iCloud with minimal impact on bandwidth or storage. The agent downloads the lightweight "Slim" index to your phone, re-hydrating content on demand only when needed.

## Stability: Reliable reasoning

The Researcher assistant is now more reliable. In previous versions, context could sometimes be lost during complex re-indexes or restarts. We have strengthened persistence to ensure that the agent's token-aware memory is preserved across sessions. Even after a plugin restart or on a newly synced device, the agent maintains its understanding of your vault.

## Flexibility: Model switching

You can now switch exclusively between different embedding models (eg Local vs Gemini) without losing your previous index. Each model maintains its own isolated storage "shard". This allows you to switch between models or online/offline modes without triggering a full re-index of your vault.

---

### Quality of life improvements

-   **Context awareness**: The Researcher assistant now uses exact token tracking for its context window across all models.
-   **Storage management**: A new "Storage" tab in Advanced settings allows you to view disk usage, prune inactive shards, or reset plugin data.
-   **Persistence**: Improved data safety during unexpected exits or heavy re-indexing operations.
-   **Model selection**: Updated model labels in settings to clearly distinguish between Gemini versions and local models.
-   **Relationship insights**: The "Similar notes" view now separates graph relationship metadata from note snippets for better readability.
-   **Startup stability**: Fixed a race condition that could cause a crash on startup.
