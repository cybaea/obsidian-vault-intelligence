# Competitive Landscape Analysis

A comparison of **Vault Intelligence** against key players in the Obsidian AI ecosystem: **Sonar**, **Smart Connections**, and **Obsidian Copilot**.

## Feature Comparison Matrix

| Feature | Vault Intelligence | Sonar | Smart Connections | Obsidian Copilot |
| :--- | :--- | :--- | :--- | :--- |
| **Search Architecture** | **Dual-Loop** (Reflex + Analyst) | Hybrid (Vector + BM25 + Rerank) | Vector + Keyword | Vector (Vault Q&A) |
| **Re-Ranking** | **Yes** (Cloud/Gemini Agent) | **Yes** (Local Cross-Encoder) | No | No |
| **Visual Notes** | **Zero-Noise Excalidraw** | Standard Indexing | Standard Indexing | Standard Indexing |
| **Vault Hygiene** | **Gardener Agent** (Active) | None | None | None |
| **Graph Algorithm** | **GARS** (Vector + Keyword + Graph) | Vector + BM25 | Interactive Graph | Vector Only |
| **Local Support** | **Embeddings Only** | **Full Stack** (llama.cpp) | Embeddings (transformers.js) | LocalAI Support |
| **Code Execution** | **Yes** (Python Solver) | No | No | No |
| **Privacy** | Hybrid (Local Index, Cloud Reasoning) | **100% Local** | Hybrid or Local | Hybrid or Local |
| **Multilingual** | **Native** (30+ Local / 140+ Agent) | Limited (Model Dependent) | AI Dependent | AI Dependent |

## Detailed Competitor Breakdown

### 1. Sonar (The "Sovereign" Specialist)

-   **Core Value**: Complete offline privacy using `llama.cpp`.
-   **Key Advantage**: Uses a "Cross-Encoder" for re-ranking, which is highly accurate but computationally expensive. Can transcribe audio.
-   **Gap**: High setup complexity (requires external runtime). "Passive" interaction—it searches, but doesn't "garden" or maintain the vault.
-   **Vault Intelligence Differentiator**: We offer the **Gardener** for active maintenance and **Excalidraw** support for visual thinkers. Our **Dual-Loop** offers the speed of local search with the reasoning power of frontier cloud models (Gemini 2.0/3.0), avoiding the hardware tax of local LLMs.

### 2. Smart Connections (The "linker")

-   **Core Value**: Discovery of related notes via an interactive graph view.
-   **Key Advantage**: "Smart Chat" allows chatting with specific notes. Good visualization of connections.
-   **Gap**: Search ranking is purely vector-based, often leading to "noisy" results compared to Hybrid/GARS.
-   **Vault Intelligence Differentiator**: **GARS** (Graph-Augmented Relevance Score) provides significantly better search ranking by weighing _centrality_ and _keywords_, not just vector closeness. Our **Gardener** actively creates connections rather than just visualizing them.

### 3. Obsidian Copilot (The "Assistant")

-   **Core Value**: General-purpose AI assistant in the sidebar.
-   **Key Advantage**: "Project Mode" and "Composer" for writing assistance. Polished UI.
-   **Gap**: Vault Q&A is often a secondary feature rather than the core Deep Search engine. Less focus on knowledge graph structure.
-   **Vault Intelligence Differentiator**: We are **Agent-First**. The Researcher is not just a chat bot; it utilizes a **Computational Solver** (Python) and **Deep Recall** to answer complex queries that reasoning models alone cannot solve. We treat the vault as a _Database_, not just text.

## Multilingual Capabilities

We treat multilingual support as a first-class citizen, not an afterthought.

-   **Vault Intelligence**:
    -   **Instant Local Search**: We ship with optimised stop-word lists and tokenizers for **30+ languages** (including Chinese, Russian, Arabic, and all major European languages) to ensure your primary search is accurate and fast.
    -   **Intelligent Reasoning**: The agent leverages state-of-the-art multilingual understanding across **140+ languages**, allowing you to query in one language (eg Japanese) and retrieve or synthesise answers from notes written in another (eg English).
-   **Competitors**:
    -   **Sonar**: Relies on the quantization of local models (llama.cpp), which often degrades performance in non-English languages.
    -   **Smart Connections/Copilot**: Heavily dependent on the underlying embedding model. While capable, they lack the specific "Hybrid Search" optimizations (native stop-words) that make retrieval precise across different languages.

## Our Unique Selling Propositions (USPs)

1.  **The Gardener**: We are the _only_ plugin that actively maintains vault hygiene, effectively "cleaning your room" rather than just helping you find things in the mess.
2.  **Dual-Loop Cognitive Architecture**: Mimics human thought (Fast Reflex vs. Slow Reasoning) to balance speed and depth.
3.  **Zero-Noise Excalidraw**: The only plugin optimized for visual thinkers, preventing SVG/JSON metadata from polluting semantic search.
4.  **GARS Scoring**: A proprietary ranking algorithm that outperforms standard vector search by incorporating Graph Theory (centrality/PageRank).

## Visuals (Placeholders)

-   [Screenshot: Dual-Loop Search Interface]
-   [Screenshot: Gardener Plan with Diff View]
-   [Screenshot: Zero-Noise Excalidraw Search Results]
-   [Screenshot: GARS Scoring Visualization]
