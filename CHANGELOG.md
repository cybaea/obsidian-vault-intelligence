# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### User features

### Developer features

## [2.0.1] - 2026-01-20

### User features

- **Unified agentic terminology**: Standardised all major features under a role-based naming convention: **Researcher** for chat and reasoning, **Gardener** for vault hygiene and ontology management, and **Explorer** for similarity search and graph discovery.
- **Gardener agent for vault hygiene**: Introduced a proactive agent that analyses note metadata and suggests improvements based on a shared ontology. It operates on a "plan-review-apply" model to ensure user oversight and safety.
- **Centralized ontology management**: Established a formal directory structure (`Concepts`, `Entities`, `MOCs`) and an `Instructions.md` file to guide AI classification, ensuring consistent naming and tagging across the vault.
- **Interactive hygiene plans**: Refactored the Gardener's output into an interactive markdown interface. Users can now review, select, and apply specific metadata changes directly from the plan note.
- **Background indexing**: All vector indexing and graph relationship analysis has been offloaded to a dedicated web worker, ensuring the main thread remains responsive even during large vault operations.
- **High-recall similarity search**: Significantly improved the "similar notes" recall by bypassing Orama's default 80% similarity threshold. You can now see notes with lower similarity scores (down to 1% or whatever your settings specify).
- **Seamless provider switching**: Fixed a bug where switching between local and Gemini embedding providers would cause "unauthorized access" errors. The plugin now dynamically routes requests to the correct engine instantly.
- **Model selector dropdowns**: Replaced manual text fields with intuitive dropdown menus for chat, grounding, and code models, pre-populated with the latest Gemini models.
- **Custom model support**: Added "custom" options for all model categories, providing full control for power users to use specialized or experimental model IDs.
- **Local model management**: Standardized selection for local embedding models with automatic dimension validation and a new "force re-download" utility for easier troubleshooting.
- **Improved synchronization**: Refined the indexing engine to detect changes in file size and modification time, ensuring search results are always accurate.
- **Default code execution**: Changed the default setting for "enable code execution" from **off** to **on**, enabling the computational solver (Python execution) by default for all new installations.

### Developers

- **Agent service refactoring**: Decomposed the monolithic `AgentService` into specialized `SearchOrchestrator` and `ContextAssembler` components to improve maintainability and allow for independent unit testing.
- **Safe metadata management**: Implemented a `MetadataManager` service to centralize frontmatter updates, using atomic file operations to prevent race conditions during automated vault maintenance.
- **Shadow graph infrastructure**: Integrated `graphology` within the indexer worker to track note relationships and wikilinks alongside vector embeddings.
- **Async indexer worker**: Implemented a Comlink-powered background indexer that manages an Orama vector store and a relationship graph concurrently.
- **Dynamic routing service**: Implemented `RoutingEmbeddingService` to handle multi-provider delegation, decoupling the graph indexing logic from specific embedding implementations.
- **Index safety and model tracking**: Enhanced index persistence to track specific embedding model IDs. The plugin now automatically triggers a full re-index if the model is changed, even if dimensions are the same, preventing data corruption.
- **Strict type safety**: Fully refactored the background worker to eliminate all `any` casts and `eslint-disable` comments, using Orama's native `RawData` types for robust state handling.
- **Worker robustness**: Implemented a 4-stage stability fallback (Threads -> 1 thread -> No SIMD -> Circuit Breaker) and improved lifecycle management with `fullReset` capabilities.
- **Boot grace period**: Added a proactive detector that triggers stable modes immediately if the worker crashes within 10 seconds of startup.
- **Enhanced diagnostics**: Improved worker-side logging for "empty file" scenarios and Orama state migration to help diagnose indexing coverage.
- **Model hygiene**: Added a `quantized` flag to the `ModelRegistry` to support loading unquantized models (like Potion-8M) and implemented worker-side event loop yielding to prevent 60s timeouts on large files.
- **Stable mode persistence**: Automatically updates and saves plugin settings when stable modes are triggered to prevent repeat crashes in future sessions.


## [1.5.0] - 2026-01-10

### 🚀 Added


### User Features

#### 🛡️ Sovereign Intelligence (Local + Offline)

- **Zero Data Leakage:** You can now switch the Embedding Provider to `Local` in settings. This downloads an open-source model (like *Nomic-Embed* or *Potion-8M*) to your device, allowing you to index and search your vault without data ever leaving your machine.
- **Cost Savings:** "Similar Notes" and search now work completely free, without consuming your Gemini API quota.

#### ⚡ Efficiency

- **Smart Indexing:** The plugin now intelligently waits 5 seconds after you stop typing before active re-indexing. This prevents "spamming" the Gemini API with partial edits, significantly reducing your token usage and billing costs.

### 🛠 Developers

- **Transformers.js Integration:** Implemented a dedicated Web Worker using `@xenova/transformers` to run ONNX models inside the plugin environment.
- **Fetch Proxy:** Created a message-passing proxy to route worker network requests through the main process, bypassing strict CORS/CSP policies and sanitizing headers to prevent 401 errors from Hugging Face.
- **Debounce Refactor:** Consolidated all indexing triggers into a single `VectorStore.requestIndex` method with a `Map<FilePath, Timer>` registry. This prevents race conditions and eliminates redundant "double-debouncing".
- **Type Safety:** Fixed critical `Float32Array` buffer detachment issues (`copyWithin` errors) during vector storage resizing.
- **Fine-Tuning:** Added dedicated settings for `queueDelayMs` and `embeddingThreads` to fine-tune performance on different hardware.
- **Fixed InteliSense errors** in Visual Studio Code. No user impact, but it makes the developer happy. [PR44](https://github.com/cybaea/obsidian-vault-intelligence/pull/44)


## [1.4.0] - 2026-01-03

### 🚀 Added

- **Computational Solver:** The agent can now write and execute Python code to analyze data from your vault (e.g., *"Read @Monthly Expenses and forecast next month's spend"*).
- **Settings:** New **Enable code execution** toggle for the Computational Solver above(Default: Off) and corresponding **Code model** selector in the Models tab.
- **Settings:** New **Context window budget** setting (Default: 200,000 tokens). This allows users to control how much "memory" the agent uses per request, balancing deep context against API rate limits.

### ⚡ Changed

- **Context Engine:** Replaced the static 50,000-character limit per note with a "Greedy Packing" strategy. The agent now reads entire documents whenever the token budget allows, **significantly improving** its ability to understand long reports and avoiding arbitrary cut-offs.

### 🛠 Developers

- **Dynamic Tools:** Updated `AgentService` to dynamically construct the `tools` array at runtime. This resolves an issue where conditional tools (like the solver) were defined but not correctly passed to the model if disabled.
- **Response Parsing:** Refactored `GeminiService` to manually parse multi-part responses (`text`, `executableCode`, `codeExecutionResult`), resolving SDK warnings about mixed content types.
- **Context Limits:** Removed hardcoded `MAX_TOTAL_CONTEXT` constants. Context limits are now calculated dynamically based on the user's `contextWindowTokens` setting.
- **System Prompt:** Updated the default system prompt to include specific instructions on when and how to utilize the `computational_solver` tool.

## Older versions

Older changes can be found in the repository's [GitHub releases](https://github.com/cybaea/obsidian-vault-intelligence/releases).