# 5.2.0 — The Performance & Resilient Intelligence Update

Version 5.2.0 is a milestone in speed and reliability. By overhauling our retrieval pipelines and hardening our persistence layer, we have created an agent that is not only twice as fast but also more resilient to the complexities of large-scale vault synchronization. This release also marks a shift towards "Graph-Enhanced Intelligence", where your research agent prioritises the deep conceptual structure of your notes over simple keyword matches.

## Blazing-fast agent reasoning

We have reduced agent response times by up to 50% through a complete overhaul of the search orchestrator. By intelligently bypassing redundant reranking loops during tool execution, your Researcher can now synthesize answers from your vault with significantly lower latency. The agent is now more agile, moving directly from retrieval to reasoning without the overhead of previous versions.

## Ironclad data resilience

Stability is the bedrock of a trusted second brain. This update introduces atomic-like binary persistence for the `.vault-intelligence` data directory. This hardened approach prevents data corruption during background synchronization conflicts or unexpected application crashes. Additionally, we have resolved persistent CORS errors that previously affected local embedding models, ensuring a smooth, offline-first experience regardless of your network configuration.

## Graph-enhanced semantic intelligence

The "Similar Notes" view and agent retrieval have been upgraded with a hybrid scoring engine. Vault Intelligence now prioritises conceptually linked topic siblings (Graph Neighbors) over pure vector similarity when the connection is strong. This means the agent understands that notes are related not just because they use similar words, but because they belong to the same intellectual lineage in your vault's hierarchy.

---

### Quality of life improvements

- **Intelligent resource usage**: Added per-file indexing delays (30s for active notes) and file-change verification (`mtime` and `size`) to reduce API costs and CPU load.
- **Multilingual mastery**: Introduced robust stopword support for over 30 languages, including specialized mapping for Chinese, Hindi, and Japanese.
- **Customizable precision**: Added presets for indexing chunk sizes, allowing you to optimize for everything from small local models (256 tokens) to large cloud deployments (2048 tokens).
- **Refined controls**: All settings that require a re-index now feature high-visibility warnings, and re-indexing is intelligently deferred until you close the settings dialog.
- **Standardized UI**: Synchronized visual highlights and action buttons with native Obsidian design tokens for a more integrated feel.
- **Data transparency**: Added a new "Danger Zone" in Advanced settings for purging plugin data and a comprehensive [Uninstall and Cleanup](https://cybaea.github.io/obsidian-vault-intelligence/docs/how-to/uninstall-and-cleanup.html) guide.
