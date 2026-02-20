# Vault Intelligence: Key User Features

## Core Philosophy: The Active Partner

Vault Intelligence transforms Obsidian from a passive storage system into an active collaborator. It doesn't just "search" your notes; it reasons about them, maintains them, and connects them.

## 1. The Researcher (Agentic Reasoning)

Your primary interface for interacting with your knowledge base.

-   **Dual-Loop Architecture**:
    -   **Loop 1 (Reflex)**: Instant, typo-tolerant search that runs locally on your device (<100ms).
    -   **Loop 2 (Analyst)**: A deep-reasoning agent that uses "Asymmetric Embeddings" to understand complex questions and trace "hidden threads" across your vault.
-   **Deep Recall**: The agent follows metadata bridges (tags, active file context, frontmatter topics) to find connections between notes that don't explicitly link to each other.
-   **Multilingual Native**: Fully supports querying and reasoning in **140+ languages**. We combine high-performance local indexing for **30+ major languages** with the deep linguistic understanding of frontier AI models.
-   **Active Context Awareness**: Automatically prioritizes your currently open note and can "see" what you are working on.

## 2. The Explorer (Discovery & Search)

A next-generation search engine built for the "I know I wrote this somewhere" moments.

-   **Semantic Galaxy View**: A high-performance, interactive 3D-like graph that visualises your vault's relationships in real-time. It centres on your active note, bridging the gap between structural links and semantic similarity.
-   **Visual RAG (Retrieval-Augmented Generation)**: The graph reacts to the Researcher agent. When the AI mentions notes in its reasoning, they are automatically highlighted in the galaxy to provide spatial context.
-   **Graph-Augmented Relevance (GARS)**: A unique scoring algorithm that combines:
    -   **Vector Similarity**: Conceptual matches ("Idea" matches "Thought").
    -   **Keyword Precision**: Essential term matching (BM25).
    -   **Graph Centrality**: Boosting notes that are "hubs" of knowledge (PageRank-like).
-   **Zero-Noise Excalidraw**: Specialized indexing for visual thinkers. It strips away internal JSON metadata so drawings only appear in search when their _text_ matches your query.
-   **Hybrid Search**: Merges fuzzy keyword search with vector semantic search for Permissive Recall (finding "cat" in "cats").
-   **Slim-Sync Engine**: The searchable index is up to 90% smaller on disk, ensuring lightning-fast syncing across devices without hitting storage limits.
-   **Model-Specific Sharding**: Isolate storage for different embedding models, allowing you to switch between Local and Gemini providers without losing data or risking corruption.
-   **Self-Healing Index**: Automatically re-indexes when you change models or configurations.

## 3. The Gardener (Vault Hygiene)

The first AI agent dedicated to keeping your vault clean.

-   **Proactive Maintenance**: Reads your vault's ontology and suggests structure.
-   **Topic Classification**: Automatically identifies notes that are missing `topics` and suggests valid ones from your existing hierarchy.
-   **Interactive Plans**: Generates "Hygiene Plans" (markdown files) that let you review and apply changes with a single click—ensuring you always remain in control.

## 4. Architecture & Privacy

Built for performance, privacy, and sovereignty.

-   **Sovereign Intelligence**: Option to run **Local Embeddings** (Nomic, etc.) so your vector data never leaves your device.
-   **Privacy-First**: Detailed control over what gets sent to the cloud. "Trust but Verify" modals for any agent write operations.
-   **Worker-First Design**: Heavy lifting (indexing, graph traversal) happens in a background web worker, keeping the Obsidian UI unrelatedly smooth.
-   **Computational Solver**: The agent can write and execute Python code to analyze data within your notes (eg "Calculate the average rating of books I read this year").
