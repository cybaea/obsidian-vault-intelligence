# Vault Intelligence 5.0.0

The AI agent for Obsidian that mimics human cognition with Dual-Loop Search.

## The Dual-Loop Update

We've rewritten the search engine to be both faster and deeper.

**Loop 1: Reflex Search (The Spotlight)**
Instant results as you type. Now with **Typo Tolerance** (matches "storis" to "stories") and **Permissive Matching** (finds "Cat" in "Stories about cats").

**Loop 2: Analyst Search (The Agent)**
A deep-dive mode that uses **Asymmetric Embeddings** to understand that your query is a *question* and your notes are *answers*. It traces "hidden threads" across your vault using metadata to find context that simple keyword search misses.

### ⚠️ Action Required
**You must Re-index your vault** after updating to v5.0.0. We changed the fundamental vector math (Asymmetric Embeddings), so your old index is incompatible.

### Highlights
*   **Dual-Loop Architecture**: Reflex speed + Analyst depth.
*   **Asymmetric Embeddings**: Drastically better semantic retrieval.
*   **Zero-Noise Excalidraw**: Drawings are indexed by text labels only. 99% smaller index.
*   **Self-Healing**: The plugin now automatically fixes itself when you change model settings.

### Try it now
Install via BRAT: `cybaea/obsidian-vault-intelligence`
