# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

New features are added in the "Unreleased" section.

## [Unreleased]

### Fixed

-   Deep hardening of Semantic Galaxy rendering:
    -   Fixed WebGL "0x0 death" in background tabs using `allowInvalidContainer` and `IntersectionObserver`.
    -   Fixed physics engine "implosions" (NaN coordinates) using symmetric coordinate seeding and strict self-loop protection.
    -   Fixed camera animation crashes by implementing multi-layer NaN guards for WebGL matrices.
    -   Improved theme color resilience with robust CSS variable resolution and Hex color support.
    -   Fixed Sigma v3 event payload extraction for native Obsidian hover previews.
-   **Researcher UI**: Fixed a bug where the model selection dropdown would fail to display newly available models (like Gemini 3.1 Pro) after a fresh API fetch. The dropdown now dynamically updates across all views in real-time.

### Breaking changes

-   **Minimum Obsidian Version**: The minimum required version of Obsidian has been bumped to **v1.11.4** to support the native `SecretStorage` API. Users on older versions will not be able to install or update to this version.
-   **API Key Synchronization**: To improve security, your Google Gemini API key is now stored in your device's secure OS keychain (e.g., macOS Keychain, Windows Credential Manager) rather than in plain text. Because of this, **API keys will no longer sync across devices via Obsidian Sync or iCloud**. You will need to manually enter your API key once on each device you use.

### User features

-   **Semantic Galaxy View**: Replaced the static relationship list with a high-performance, interactive 3D-like graph view. The "Semantic Galaxy" visualises your vault's relationships in real-time, centering on your active note.
    -   **Visual RAG**: The graph now reacts to the Researcher agent. When the AI mentions files in its response, those notes are automatically highlighted in the galaxy, providing instant spatial context for the agent's reasoning.
    -   **Structural & Semantic Discovery**: The view blends structural Wikilinks (BFS) with semantic vector similarities, allowing you to discover both explicit and hidden connections in your knowledge base.
    -   **Fluid Interaction**: Supports smart-panning, node-hover previews (native Obsidian hover), and click-to-navigate functionality.
    -   **Interactive Layout Controls**: Added a real-time "Attraction" slider to the graph view. Note clustering is driven by mathematical semantic scores; highly-related concepts will physically pull together, and the slider lets you tune this gravity. Includes a "Reshuffle" button to instantly regenerate the layout from scratch if it gets tangled.
    -   **Adaptive Rendering**: Edge labels dynamically scale and shift coloring to support high contrast modes like Obsidian Dark Mode natively.
    -   **Physics Stability**: Resolved an issue where high attraction could collapse the graph into a 1D line by dynamically scaling repulsive forces to maintain 2D dispersion.
-   **Improved Security**: Upgraded the plugin to use Obsidian's native Secure Storage. Your API keys are now encrypted and stored safely in your operating system's keychain rather than sitting in plain text in your vault folder. 
-   **Linux Compatibility**: Added an intelligent fallback mechanism for Linux users. If your system (e.g., Flatpak or minimal distros) does not have a reachable keychain, the plugin will gracefully fall back to the legacy plain-text storage rather than crashing or nagging you.

### Developer features

-   **High-performance WebGL Graphing**: Integrated Sigma.js and Graphology into the Obsidian UI. Implemented a Singleton-like Sigma managed instance with `IntersectionObserver` to ensure zero CPU/GPU overhead when the view is not visible.
-   **Yielding Worker Layout**: Refactored the ForceAtlas2 layout engine to run in the background worker with a yielding strategy (via `setTimeout(0)`), ensuring the main thread stays 100% responsive during complex graph calculations.
-   **BFS Subgraph Extraction**: Implemented a "Quota-limited BFS" algorithm in the indexer worker to extract local subgraphs (max 250 nodes) centered on active files, ensuring consistent performance regardless of vault size.
-   **Semantic Injection**: Added logic to inject top-K semantic neighbors into the structural graph, bridging the gap between vector search and graph theory.
-   **Smart Layout Seeding**: Implemented positional seeding to prevent graph "jumping" during updates by reusing previous node coordinates where available.
-   **Internal Event Bus**: Leveraged `GraphService` as a centralized, type-safe internal event bus for Visual RAG orchestration, eliminating `any` casts and collisions on `app.workspace`.
-   **Secure API key storage**: Migrated Google Gemini API keys from plain text `data.json` to Obsidian's native `SecretStorage` API (v1.11.4+).
    -   **JIT initialization**: Refactored `GeminiService` to use asynchronous just-in-time client instantiation, preventing "Async Constructor" race conditions during plugin load.
    -   **Stable secret IDs**: Mandated a persistent secret ID (`vault-intelligence-api-key`) to prevent sync-induced "ping-pong" conflicts between multiple devices.
    -   **Robust Linux fallback**: Implemented a fail-safe migration handler that automatically detects and suppresses repeated keyring failures on minimal Linux environments, falling back to secure-ish plain text only when necessary.
    -   **Improved UI security**: Replaced the standard text input with Obsidian's `SecretComponent`, providing clear visual feedback on encryption status and better UX for managing credentials.
    -   **Worker Security Isolation**: Removed the API key from the `WorkerConfig` interface and all Web Worker memory spaces. The background indexer now relies entirely on the main thread for all authenticated API proxying, adhering to the principle of least privilege.
-   **Strict Typing & Linting**: Eliminated `any` typings and ESLint bypasses around the `GeminiService` by utilizing `import type` to resolve circular dependencies, ensuring 100% strict type safety.

## [7.0.0] - 2026-02-15

### Breaking changes

-   Legacy database migration (v5.x and earlier) has been removed to improve performance and code health. Users upgrading from older versions must re-index their vault manually via **Settings > Explorer > Re-index vault**.

### User features

-   **Explorer stability fix**: Resolved a race condition that prevented the "Similar notes" view from loading results automatically after a plugin reload. Added a helpful "Open a note" message when no file is active to improve onboarding.
-   **SSRF opt-in security**: Implemented an explicit "Allow Local Network Access" toggle in Advanced settings. This allows power users to grant the agent access to local services (eg Ollama or internal dashboards) while maintaining perfect protection for everyone else. Found and fixed a critical vulnerability where the live agent was bypassing existing SSRF checks.

### Developer features

-   **Service-Oriented Architecture (SOA) Refactor**: Major architectural overhaul of the graph indexing system.
    -   Introduced `GraphSyncOrchestrator` to handle all background maintenance, vault event debouncing, and model lifecycle management.
    -   Refactored `GraphService` into a specialized, read-only facade that proxies queries to the worker, improving separation of concerns and testability.
    -   Consolidated model state persistence and worker configuration into the orchestrator.
-   **Red Team Repairs**: Addressed critical race conditions in `GraphSyncOrchestrator`, including event listener leaks, premature scan completion, and dropped mutations during config changes.
-   **Event Hygiene**: Namespaced all graph events (`graph:index-ready`) to prevent collisions and implemented strict event registration gating.
-   **Orphan Pruning**: Restored `pruneOrphans` logic to `scanAll` to ensure deleted files are removed from the index during full scans.
-   **Error Masking**: Implemented defensive `try/catch` facades in `GraphService` to gracefully handle worker restarts without throwing uncaught errors to the UI.
-   **SSRF protection**: Implemented strict URL validation in `UrlReaderTool` to prevent server-side request forgery (SSRF). The new `isExternalUrl` utility strictly blocks requests to local, private, and loopback IP addresses (ie `localhost`, `127.x`, `0.0.0.0`, `[::1]`) and cloud metadata services by default. Always blocks metadata services even when opt-in is enabled. Verified with a new comprehensive URL security test suite.
-   **Prompt injection hardening**: Replaced the `MarkdownRenderer` in the `ToolConfirmationModal` with a raw `<pre><code>` block. This prevents malicious content from hiding instructions using CSS (the "confused deputy" attack) by ensuring all markdown and HTML tags are visibly exposed to the user before confirmation. Removed associated `Component` lifecycle management to simplify the modal and prevent dead code.
-   **Worker promise leak fix**: Implemented a context-aware "Smart Timeout" for the embedding worker fetch proxy. It allows up to 15 minutes for large model asset downloads while maintaining a strict 30-second limit for standard API calls, preventing permanent memory leaks from hung requests without impacting operation on slow connections.
-   **Storage leak fix**: Resolved a hidden storage leak in `PersistenceManager` by removing the unused `wipeState` method.
-   **Atomic frontmatter preservation**: Refactored `FileTools.updateNote` to use a single, atomic `vault.process` operation. This fixes a critical race condition where frontmatter could be erased due to a stale `MetadataCache` and eliminates an inefficient "double-write" pattern. Verified with a new comprehensive atomic-consistency test suite.
-   **Path security hardening**: Implemented a robust path normalization and exclusion check in `ToolRegistry.ts`. This fixes a critical vulnerability where path traversal (ie `../`), extension bypasses, and rename operations could be used to access or modify files in excluded folders. Verified with a new comprehensive security test suite.
-   **Persistence Manager resilience**: Isolated volatile IndexedDB ("Hot Store") operations in `saveState`, `loadState`, `deleteState`, and `purgeAllData` with dedicated try/catch blocks. This prevents IndexedDB failures (eg QuotaExceeded or Private Browsing restrictions) from blocking critical file system operations or causing infinite re-index loops. Verified with a new resilience test suite.
-   Improved type safety in `PersistenceManager.loadState`.

## [6.0.2] - 2026-02-14

### User features

-   **Regex performance optimization**: Completely rewrote the `semanticSplit` function in the Indexer Worker to use index-scanning instead of a lazy-lookahead Regex. This eliminates a CPU-bound loop that caused the worker to freeze when indexing massively large markdown files (5MB+) lacking headers.
-   **Ghost node prevention**: Fixed a bug where file renames could result in "ghost nodes" and indexing drifts. The `onRename` handler now explicitly deletes the old path before enqueuing a re-index for the new path.
-   **Indexer schema hardening**: Resolved a schema leak in the Orama worker where undefined properties were being passed to the index, potentially causing hydration failures.

-   **Chunked batch updates**: Refactored `GraphService` to batch background file updates and `scanAll` indexing into chunks of 50 files or 5MB. This significantly reduces IPC overhead and prevents memory spikes.
-   **Active-file prioritisation**: Implemented a dual-timer strategy (30s for active, batched for background) to prioritise the current note while ensuring background syncs are efficient.
-   **Atomic tab switching**: Added safeguards to ensure pending active updates are downgraded to background batches during tab transitions, eliminating data loss.
-   **Ghost node prevention**: Fixed a critical edge case where renaming a file without altering its contents permanently dropped its text from the semantic index. File renames now automatically trigger a targeted background re-embed.

## [6.0.1] - 2026-02-13

### User features

-   **Explorer stability**: Fixed an issue where the "Similar notes" view would get stuck in a "Content drifted" display immediately after restarting Obsidian.

### Developer features

-   **Hot Store hydration fix**: Fixed a regression in `IndexerWorker.loadIndex` where the "slim" vault index was loaded instead of the full IndexedDB "Hot Store" index on startup, which caused all search results to return empty text excerpts.
-   **Drift recovery accuracy**: Corrected the `ResultHydrator.anchoredAlignment` sliding window algorithm to use exact chunk-length hashing rather than line-by-line hashing, allowing it to successfully recover drifted text.
-   **Repaint debouncing**: Added a 1-second debounce to the `index-updated` event listener in `SimilarNotesView` to efficiently batch UI repaints and prevent layout thrashing.

## [6.0.0] - 2026-02-12

### User features

-   **Large-vault power-up**: We've overhauled the engine to handle 10,000+ notes with ease. By eliminating memory spikes, the plugin is now rock-stable and responsive even in massive knowledge bases.
-   **Intelligent model switching**: You can now switch embedding models (eg between Local and Gemini) without losing your previous index. Each model maintains its own secure, isolated storage "shard", allowing for seamless transitions.
-   **Precise context awareness**: The Researcher assistant now uses exact token tracking for its "memory" across all Gemini and local models. This ensures more reliable answers and prevents unexpected cut-offs in long conversations.
-   **Mobile-ready semantic index ("Slim-Sync")**: Our new "Slim-Sync" strategy is a game-changer for mobile users. Your searchable index is now up to 90% smaller on disk, ensuring lightning-fast syncing across devices via Obsidian Sync or iCloud without devouring your storage.
-   **Amnesia-proof AI reasoning**: The Researcher assistant is now remarkably more reliable. Even after a plugin restart or on a newly synced device, it always maintains a deep "memory" of your vault for perfect context-aware answers.
-   **Advanced storage management**: A new "Storage" tab in Advanced settings lets you see which model indices are taking up space and allows you to prune inactive shards or fully reset your plugin data with one click.
-   **Unstoppable persistence**: The plugin now ensures your graph data is safely saved even when you exit Obsidian unexpectedly or during a heavy re-index, preventing data loss.
-   **Clearer model selection**: Updated model labels in settings to make it easier to distinguish between different Gemini versions and local models.
-   **Crisp relationship insights**: Discovering connections is now much cleaner. The "Similar notes" view now separates graph relationship metadata (eg "Sibling via Topic") from the note snippets, making it easier to see exactly why notes are linked.
-   **Instant startup stability**: Fixed a critical "startup crash" flaw, ensuring the plugin is ready to use the moment you open Obsidian.

### Developer features

-   **Model-specific sharding**: Implemented sharded storage in `PersistenceManager` to namespace graph and vector state by model hash and dimension, preventing cross-model data corruption.
-   **Native token tracking**: Refactored `ContextAssembler` and `SearchOrchestrator` to aggregate `tokenCount` directly from API usage metadata and worker outputs, replacing character-count heuristics.
-   **Precise RAG context**: Augmented file metadata with `tokenCount`, allowing the Researcher to estimate context relevance with perfect accuracy before reading files.
-   **IDB isolation (Split-brain fix)**: Separated IndexedDB namespacing for the Main-thread buffer (`orama_index_buffer_`) and Worker-thread hot store (`orama_index_`), eliminating split-brain collisions during background sync.
-   **Hybrid Slim-Sync architecture**: Implemented a "Hot/Cold" storage strategy. The full index is stored in IndexedDB for performance, while a "slim" (content-stripped) copy is synced to the vault for cross-device compatibility.
-   **Main-thread hydration**: Refactored `GraphService` to perform note content hydration on the main thread, overcoming worker memory limits and enabling RAG for stripped indices.
-   **Robust MessagePack decoding**: Implemented `decodeMulti` in persistence logic to handle multi-stage decoding for complex state objects.
-   **Memory-efficient serialization**: Eliminated memory spikes during index saving by replacing deep cloning with typed, iterative state hollowing.
-   **Standardized token estimation**: Replaced hardcoded math with `SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE` across all services, ensuring perfectly consistent context budgeting.
-   **Sharded storage integrity**: Fixed an IDB key collision in the indexing worker that was causing "split-brain" state issues during background sync.
-   **Markdown rendering fix**: Resolved the "Plugin is not passing Component in renderMarkdown" error by implementing internal `Component` lifecycles in modals.
-   **Automatic state migration**: Added logic to detect legacy `graph-state.msgpack` files and migrate them to the new sharded format.
-   **Updated dependency**: Updated `@google/genai` to `v1.41.0`.
-   **Enhanced test suite**: Added comprehensive integration tests for `GraphService` lifecycle and `PersistenceManager` storage sharding.

## [5.2.1] - 2026-02-11

### User features

### Developer features

## [5.2.0] - 2026-02-11

### User features

-   **Search performance overhaul**: Reduced agent response times by up to 50% by bypassing redundant reranking loops during tool execution.
-   **Local embedding stability**: Resolved CORS errors that occurred when using local models by ensuring correct service routing.
-   **Persistence stability**: Hardened state persistence using atomic-like binary operations in the `.vault-intelligence` folder, preventing data corruption during crashes or background synchronization conflicts.
-   **UI refinements**: Standardized visual highlighting for similarity scores and aligned action buttons with native Obsidian design tokens.
-   **Cleanup guide**: Added an [Uninstall and Cleanup](docs/how-to/uninstall-and-cleanup.md) guide for managing the plugin's data footprint.
-   **Redundant embedding prevention**: Reduced API usage by verifying file changes (via `mtime` and `size`) before requesting new embeddings.
-   **Indexing debounce**: Added per-file indexing delays (30s for active notes, 5s for background files) to optimize resource usage.
-   **Purge and reset**: Introduced a "Danger Zone" in Advanced settings with a button to fully reset or purge plugin data.
-   **Customizable chunk sizes**: Control how your notes are split for indexing. Added presets ranging from 256 for local models to 2048 for cloud-only English vaults.
-   **Robust stopword support**: Added intelligent stopword mapping for 30+ languages, including specific support for Chinese (Mandarin), Hindi (Indian), and Japanese.
-   **Deferred re-indexing**: Re-embeddings now wait until you close the settings dialog, allowing for multiple changes without redundant re-scans.
-   **Idempotent re-index queuing**: Reverting a setting back to its original value before closing the dialog now correctly cancels any pending re-index.
-   **High-visibility warnings**: Added prominent "yellow box" warnings for settings that require a full vault re-index, ensuring no surprises.
-   **Similar notes fix**: Resolved a race condition causing duplicate entries in the "Similar notes" view.
-   **Enhanced similarity intelligence**: The "Similar Notes" view now utilises a more robust hybrid scoring engine that prioritises conceptually linked topic siblings (Graph Neighbors) over pure text similarity (Vector matches) when the connection is strong.

### Developer features

-   **Deep search toggling**: Added a `deep` option to the `SearchOrchestrator.search` method to allow manual control over the "Analyst Loop" (Loop 2).
-   **Dynamic latency sizing**: Refactored `LATENCY_BUDGET_TOKENS` into a dynamic value calculated from a multiplier of the chunk size.
-   **Persistence hardening**: Fixed "Folder already exists" errors during startup by improving existence checks for the `.vault-intelligence` directory.
-   **Version baseline**: Set minimum required Obsidian version to `v1.5.0`.
-   **Standards codification**: Created `devs/ARCHITECTURE_AND_STANDARDS.md` and `devs/REFERENCE_LINKS.md` to formalize project architecture.
-   **Agent guardrails**: Configured `.gemini/GEMINI.md` to enforce architectural alignment across agent sessions.
-   **Documentation improvements**: Updated technical documentation to fix diagrams and ensure consistency with 2026 standards.
-   **Worker API enhancement**: Added a `getFileState` method to the background worker for efficient metadata retrieval.
-   **Robust scan logic**: Integrated file size and modification time checks into the `GraphService` scanner.
-   **Constants consolidation**: Centralized indexing delay constants in `GRAPH_CONSTANTS` and refactored settings to use them.
-   **Settings UI decoupling**: Refactored the Explorer settings to use local DOM refreshes instead of full tab reloads, preventing premature `hide()` hook execution.
-   **Synchronous re-index flags**: Optimized `GraphService` to update re-index state synchronously before configuration propagation, eliminating race conditions during modal closure.
-   **SOA Refactoring phase 1**: Decomposed monolithic logic in `ResearchChatView` and `SimilarNotesView` by delegating business operations to `AgentService` and `GraphService` respectively, following the "Humble View" pattern.
-   **Service Facade extension**: Expanded `GraphService` with `getGraphEnhancedSimilar` and `AgentService` with `reflexSearch` to provide high-level APIs for views and tool registries.
-   **Loop 1 search delegation**: Formally separated the "Reflex" (Loop 1) search from the reasoning loop by moving orchestrator interaction into `AgentService`.
-   **UI Architecture cleanup**: Removed tight coupling between `SimilarNotesView` and the embedding/vault management layers, resulting in a cleaner, more testable view component.

## [5.1.1] - 2026-02-06

### User features

-   **Fast Startup**: Optimized the plugin initialization process to load the application faster, even with large vaults.

### Developer features

## [5.1.0] - 2026-02-06

### User features

-   **Simplified advanced settings**: Removed obsolete GARS tuning and search expansion sliders that are no longer supported by the version 5 search architecture.
-   **Improved configuration documentation**: Added detailed descriptions for context tuning parameters (primary, supporting, and structural thresholds) in the documentation.
-   **Refined settings UI**: Improved spacing and layout in the Advanced settings tab for better readability.

### Developer features

-   **Scoring engine cleanup**: Removed unused GARS weight parameters and search expansion seeds/thresholds from settings and types to resolve scoring ambiguity.

## [5.0.0] - 2026-02-05

### User features

-   **Deep semantic intelligence**: The Researcher now understands the "hidden threads" between your notes. By automatically treating frontmatter properties like `topics`, `tags`, and `author` as semantic bridges, the agent can discover relevant context across your vault even when you haven't used explicit Wikilinks.
-   **Zero-noise Excalidraw integration**: Visual thinkers will notice a massive improvement in search quality. We've overhauled how drawing files are indexed, stripping away megabytes of internal JSON metadata while preserving actual text labels. This makes the index up to 99% smaller and eliminates "false positive" search results from drawing files.
-   **Precision similarity intelligence**: Ghost documents and empty tags no longer clutter your "Similar Notes" view. We've refined the similarity engine to strictly only show real, indexed notes with actual content, ensuring your connections are always meaningful.
-   **Intelligent auto-reindexing**: Changing your embedding model or search dimension now automatically triggers a vault re-scan. You no longer need to manually click "Re-index vault" to align your settings—the plugin ensures your semantic index is always consistent with your configuration.
-   **Deep-dive search recall**: Drastically increased the search re-ranking pool, enabling the Researcher to find complex "hidden threads" and nuanced narratives across even the largest vaults.
-   **Keyword match calibration**: Added a "Keyword match weight" slider to the Explorer settings. This allows you to fine-tune how aggressively the plugin normalises and weights keyword (BM25) results when blending them with vector similarity.
-   **Tuning control**: Added granular reset buttons to the Advanced Settings panel. You can now restore individual Search and Context thresholds to their default values or reset the entire section with a single click.

### Developer features

-   **Accurate similarity scoring**: Fixed an issue where keyword matches could produce impossible similarity percentages (like 3333%). Scoring is now properly normalized using a sigmoidal calibration function in `SearchOrchestrator` for a reliable 0-100% scale.
-   **Search Score Fix**: Fixed a critical bug in `SearchOrchestrator` where graph neighbor scores were being zeroed out. Neighbors now correctly retain their spread activation score.
-   **Graph Math Tuning**: Increased default `ACTIVATION` weight to 0.5 and optimized threshold defaults to ensure semantic siblings are reliably included in the researcher's context window.
-   **Architectural Refactoring**: Decomposed `AgentService` by delegating tool logic to a dedicated `ToolRegistry` and context preparation to `AgentService.prepareContext`.
-   **Humble View Pattern**: Refactored `ResearchChatView` to separate UI logic from business logic, improving testability and code organization.
-   **Magic Number Elimination**: Extracted indexing and search constants into `src/constants.ts` and moved calibration constants to user settings for better maintainability.

-   **Fixed index rebuild loop**: Resolved a persistent "Delete-after-Add" race condition where mismatching paths caused the index to rebuild on every startup.
-   **Strict path normalization**: Enforced consistent path canonicalization across all worker operations (`deleteFile`, `renameFile`, `pruneOrphans`).
-   **Orphan node pruning**: Automatically cleans up stale graph nodes during scans to match the vault state precisely.
-   **Alias map casing resolution**: Fixed a critical bug in alias resolution by ensuring case-insensitive mapping between topics and files.
-   **MessagePack serialization safety**: Hardened index persistence with a circularity-aware diagnostic suite and increased recursion depth for complex Orama trees.
-   **Chunking performance**: Implemented `maxPoolResults` and `recursiveCharacterSplitter` to improve semantic search granularity without polluting results with redundant fragments.
-   **Systemic Path Resolution**: Implemented global basename aliasing in `GraphService` to resolve "Ghost Nodes". Short-form file links (e.g. `[[Note]]`) now correctly resolve to their canonical full paths across the entire vault graph.
-   **Hybrid Explorer Search**: Updated the "Similar Notes" view to merge Vector Similarity (Content) with Graph Neighbors (Topics). This ensures conceptually related notes are displayed even if they don't share similar text.
-   **BM25 Score Normalization**: Implemented normalization for keyword results in `SearchOrchestrator` to prevent impossible high-similarity scores (>100%).
-   **Strict Neighbor Filtering**: Enhanced `getNeighbors` to filter nodes by `mtime > 0` and `size > 0`, ensuring only valid, non-empty indexed notes appear in similarity results.
-   **Forced Re-scan Logic**: Added automatic `scanAll(true)` trigger in `GraphService` upon critical settings changes (model/dimension) to ensure index consistency.
-   **Robust Path Resolution**: Refined wikilink resolution to correctly handle multi-extension files and prevent accidental `.md` suffixing on non-markdown assets.
-   **Property Sanitization**: Strip surrounding quotes from YAML/frontmatter values to prevent duplicate node creation for identical topics.
-   **Search Logic Overhaul**:
    -   **Asymmetric Embedding**: Implemented query-specific embedding headers (distinguishing `Query` vs `Document`) to strictly align with the embedding model's training objective. This significantly improves vector retrieval accuracy.
    -   **Fuzzy Search Integration**: Enabled Levenshtein distance matching (`tolerance: 2`) for keyword searches. The agent can now find notes even with typos (eg "storis" finds "stories") or morphological variations.
    -   **Deep Vector Recall**: Modified the vector search pipeline to bypass Orama's default strict cut-off. We now request _all_ semantic candidates (`similarity: 0.001`) and let our GARS re-ranker handle the filtering. This solves "empty result" issues for broad conceptual queries.
    -   **Permissive Hybrid Merging**: Configured keyword search to use a permissive recall threshold (`1.0`) combined with local score normalization. This ensures that a strong keyword match for one term (eg "cats") isn't discarded just because other terms in the query are missing.

## [4.3.1] - 2026-01-31

### User features

-   **Active tab context prioritisation**: The Researcher assistant now correctly identifies and prioritizes the document you are currently focused on. It also excludes "hidden" background tabs from its context, ensuring it only sees what you see.

### Developer features

## [4.3.0] - 2026-01-31

### User features

-   **Agentic file modification**: The Researcher is no longer read-only! It can now create notes, update existing files, and organize folders upon request (e.g., "Create a summary of this chat in a new note").
-   **Human-in-the-loop security**: All write operations trigger a "Trust but Verify" confirmation modal, showing you exactly what the agent wants to change (including diffs for updates) before any data is touched.
-   **Granular write control**: A global "Enable agent write access" setting (default: off) plus a per-chat toggle gives you precise control over when the agent is allowed to modify your vault.
-   **Language support**: The Research Assistant now speaks your language! Choose from a list of presets or enter any custom IETF BCP 47 language code (eg `fr-FR`). The `{{LANGUAGE}}` placeholder in system prompts is automatically replaced with your choice.
-   **Transient model switching**: Added a model selection dropdown to the Research Chat header, allowing you to temporarily switch models for specific queries without changing global settings.
-   **On-the-fly capability toggling**: Added a toggle to the Research Chat header to enable or disable the computational solver for the current session.
-   **Improved UI stability**: Fixed a race condition in the chat interface that caused duplicated messages during rapid "Thinking" updates. The "Thinking" indicator now appears instantly for better feedback.
-   **"What's New" splash screen**: A beautiful new walkthrough modal that automatically displays release notes after a plugin update, keeping you informed of the latest capabilities.
-   **Auto-updating prompts**: System instructions now default to a "managed" state, allowing you to automatically receive improvements to the default persona while still retaining the ability to override them with custom prompts.
-   **"Other" language input**: Selecting "Other" in the language dropdown now immediately reveals a text input for custom language codes, ensuring you can use any language supported by the model.
-   **System prompt reset**: Added a specific "Reset" button for system instructions to easily revert to the default managed prompt.
-   **"Fetch or Fallback" release notes**: Implemented a resilient fetching system that retrieves rich release notes (including images) directly from the GitHub API, with a graceful fallback to a manual link if you are offline.
-   **Integrated documentation**: Added direct links to the official VitePress documentation across all settings sections. Each tab now includes section-specific anchors to help users find relevant help articles instantly.
-   **Responsive chat header**: The Research Chat controls now wrap gracefully to ensure usability even in narrow sidebars.
-   **"Show release notes" command**: A new command to manually open the release notes modal at any time if you want to revisit the latest changes.
-   **Stable model aliases**: Updated all default model IDs to use the newest latest aliases (ie gemini-flash-latest), ensuring the plugin always points to the frontier versions.
-   **Session reset**: New reset button in the Research Chat header to quickly revert session settings to your global defaults.
-   **Sponsor button**: Added a prominent Sponsor button to the release notes modal, styled with GitHub's signature pink outline and dynamically linked to the project's funding configuration.
-   **Improved settings visibility**: Refined the placement of documentation links, moving them into subheadings and under section headers for better accessibility and a cleaner UI.
-   **Improved documentation clarity**: Clarified API key storage security and ensured consistent British English usage throughout the configuration guide.

### Developer features

-   **FileTools architecture**: Implemented a dedicated FileTools class to encapsulate safe filesystem operations (createNote, updateNote, renameNote) with recursive folder creation and path normalization.
-   **Strict content sanitization**: Added a robust sanitization pipeline that aggressively strips YAML frontmatter from agent-generated content to prevent metadata corruption.
-   **Link-aware renaming**: The rename_note tool utilizes app.fileManager.renameFile, ensuring Obsidian automatically updates all wikilinks pointing to the moved file.
-   **Promise-based modal pattern**: Refactored ToolConfirmationModal to use a static async open() pattern, allowing the Agent's execution loop to pause and await user interaction naturally without complex event listeners.
-   **Dynamic funding resolution**: Implemented a runtime parser for `.github/FUNDING.yml` that automatically synchronizes the sponsor link without requiring manual code updates.
-   **Per-request agent overrides**: Refactored the AgentService and GeminiService to support optional overrides for model selection and tool enablement inside the Research Chat.
-   **Interactive model ID tooltips**: Restored tooltips in the Research Chat model selection dropdown to match the behaviour in the main settings.
-   **Version upgrade tracking**: Added a previousVersion field to the plugin settings to reliably detect and trigger update-specific UI workflows.
-   **Responsive walkthrough UI**: Developed a dedicated `ReleaseNotesModal` using Obsidian's `MarkdownRenderer` and future-proofed it with responsive sizing units and native design tokens.
-   **Centralized documentation URLs**: Introduced a structured `DOCUMENTATION_URLS` object in `constants.ts` to manage all external documentation links and anchors in one place. Refactored to follow DRY principles by using hierarchical constants for base and configuration paths.
-   **Centralized UI strings**: Refactored the core plugin to use a centralized `UI_STRINGS` constant for all human-readable labels, icons, and tooltips, improving maintainability and consistency.
-   **Enhanced API documentation**: Fully synchronized the internal `WorkerAPI` developer documentation with the current implementation and corrected architectural diagrams.
-   **Improved JSDoc coverage**: Added detailed inline documentation for core lifecycle methods and service orchestrators to improve developer experience and code readability.
-   **Expanded linting suite**: Integrated `stylelint`, `secretlint`, and `markdownlint-cli2` into the CI workflow to ensure high standards for CSS, security, and documentation.
-   **Code organization enforcement**: Added `eslint-plugin-perfectionist` to maintain consistent import sorting and object key ordering.
-   **Robust utility refactoring**: Improved the `isSafeUrl` utility with stricter domain validation to prevent potential security regressions in external requests.

## [4.2.0] - 2026-01-27

### User features

-   **High-performance graph storage**: Migrated graph and search index storage to MessagePack binary format. This results in up to 80% reduction in file size for large vaults and significantly faster plugin startup times.
-   **Improved disk longevity**: Increased auto-save debounce to 30 seconds and implemented a smart "force-save" on plugin shutdown, drastically reducing unnecessary disk writes without risking data loss.
-   **Automated privacy protection**: The plugin now automatically manages a nested `.gitignore` for its generated data directory, ensuring large binary index files are never accidentally committed to your repository.
-   **Semantic icons**: Updated the ribbon and menu icons to be more descriptive. The researcher now uses a "Message Circle", the Explorer uses a "Grid", and the main ribbon uses a "Brain Circuit".
-   **Thinking indicator**: Added a visual pulsing indicator to the chat interface so you know when the agent is "thinking" about your request.

### Developer features

-   **Worker-side serialization**: Offloaded MessagePack encoding and vector optimization to a background worker to eliminate UI thread latency during state persistence.
-   **Vector packing optimization**: Implemented in-memory casting of embedding arrays to `Float32Array` before serialization, leveraging MessagePack's native binary encoding for near-ideal size efficiency.
-   **Defensive binary I/O**: Added buffer-aware slicing to ensure strictly-sized binary writes, preventing file corruption from encoder over-allocation.

## [4.1.1] - 2026-01-27

### User features

### Developer features

-   Service routing delegation: Fixed an issue where the "force re-download" button was inactive by implementing proper method delegation in the `RoutingEmbeddingService` wrapper, allowing the UI to access the underlying local service instance.

## [4.1.0] - 2026-01-26

### User features

-   **Configurable context engine**: Introduced a new "Search and context tuning" section in Advanced Settings, allowing users to fine-tune the GARS algorithm and context assembly.
-   **Structural context pruning**: Implemented intelligent filtering that automatically skips low-relevance results. This restores a clean "3-5 relevant notes" context feel even when search finds dozens of matches.
-   **Adjustable relevance thresholds**: Users can now tune the Supporting (snippets) and Structural (headers) thresholds to balance detail vs prompt noise.
-   **Search expansion control**: Added a slider to control how many top results trigger graph neighbor expansion, preventing worker congestion on vague queries.
-   **Expansion score floor**: Implemented an absolute score safety guard that prevents expanding neighbors for weak/low-confidence search matches.

### Developer features

-   **Precision-tuned GARS**: Refined the Graph-Augmented Relevance Score with better spreading activation weights (0.25) and dynamic decay controls.
-   **Batch metadata optimization**: Context assembly now uses a single high-efficiency worker call to fetch headers and titles for all results, reducing latency by 95% in large vaults.
-   **Context structural cap**: Implemented a hard safety cap for structural (header-only) documents to ensure the agent is never overwhelmed by peripheral metadata.
-   **Zero-latency I/O**: Migrated all context file reading to `app.vault.cachedRead` for near-instant assembly from memory.
-   **Magic number elimination**: Centralized all internal search and context constants into `src/constants.ts` and exposed them via settings.
-   **Domination prevention**: Reduced the single-document soft limit to 10% of total budget to ensure a more diverse context window.

## [4.0.1] - 2026-01-26

### User features

### Developer features

## [4.0.0] - 2026-01-25

### User features

-   **GARS tuning**: Users can now precisely adjust the similarity, centrality, and activation weights in settings to fine-tune how the Research Assistant ranks notes.
-   **Graph & ontology awareness**: The Research Assistant now understands vault hierarchy through a new topic sibling traversal algorithm, finding related notes even if they are not directly linked.
-   **Improved hybrid search**: Combined vector and graph analysis into a unified scoring system (GARS) for more relevant search results.
-   **Adaptive context assembler**: Implemented an "Accordion" strategy that packs more context into the AI memory by intelligently switching between full text, snippets, and metadata based on relevance.
-   **Comprehensive documentation**: Added a new user guide for the Researcher and a deep technical specification for developers.
-   **Improved error feedback**: The Research Assistant and settings now provide friendly, actionable messages for authentication issues (eg "Invalid API key") instead of technical status codes or generic apologies.
-   **Reliable indexing alerts**: Background vault indexing now correctly reports critical failures (like expired API keys) to the user interface, preventing silent failures during re-indexing.
-   **Context transparency**: The Research Assistant now displays a collapsible list of all "Context Documents" used to generate the answer (Resolves #59).
-   **Interactive references**: Context documents in the chat reference list are clickable (to open the note) and draggable (to insert a link into other notes).
-   **Dynamic model fetching**: The plugin now dynamically retrieves available Gemini models from the Google API, ensuring support for the latest model versions without plugin updates.
-   **Smart model caching**: Added configurable caching for the Gemini model list to ensure a snappy settings experience while keeping the list fresh.
-   **Instant connection**: Providing a valid Gemini API key now immediately triggers a model fetch and enables model dropdowns without needing a plugin restart.
-   **Model tooltips**: Added hover tooltips to all model dropdowns showing the raw Gemini model ID for advanced users.
-   **Improved model sorting**: Model lists are now intelligently sorted to prioritize the latest Gemini versions (eg Gemini 3.0 and 2.5 families).
-   **Refined model lists**: Cleaned up dropdown menus by excluding experimental and device-bound (Nano) models by default.
-   **Grounding optimization**: Specifically restricted grounding models to Flash and Lite variants for the best balance of speed and cost during web search workflows.
-   **Model list debugging**: Added a "Log items" utility in the Developer section to print the raw Gemini API response to the console, with automatic fresh fetch if data is missing.
-   **Dynamic budget scaling**: Context budgets now automatically adjust when switching models to maintain a consistent capacity ratio.
-   **Tabbed settings interface**: Refactored the settings UI into a clean, tabbed layout (Connection, Researcher, Explorer, Gardener, and Advanced).
-   **Improved settings architecture**: Centralized tab rendering logic and standardized agent sections using a unified `SettingsTabContext`.
-   **Proportional reset buttons**: Added "Reset to default ratio" buttons to context budgets, restoring them to sensible baselines (20% for chat, 10% for gardener) based on the current model's limit.
-   **Persistent debugging**: Updated the model registry to persist raw API responses in local storage for a more reliable troubleshooting experience across restarts.
-   **UI layout optimization**: Moved the Gardener model selection to sit directly above its corresponding budget setting for a more intuitive configuration flow.

### Developer features

-   **GARS mathematical model**: Formalized the graph-augmented relevance score calculation in `ScoringStrategy.ts`.
-   **Dynamic ontology config**: Propagated `ontologyPath` settings to the background worker to ensure traversal logic respects custom folder structures.
-   **Shadow graph specification**: Created a deep technical document (`devs/shadow-graph-technical.md`) covering architecture, pipelines, and algorithms.
-   **UI standardization**: Refined settings labels and messages to strictly follow sentence case for a more native feel.
-   **Critical error propagation**: Updated the Indexer Web Worker to explicitly re-throw authentication and API errors back to the main thread.
-   **Throwing model discovery**: Enhanced `ModelRegistry.fetchModels` with an optional `throwOnError` flag to allow UI-driven error handling during model refreshes.
-   **Security hardening**: Removed a leaked API key from the test suite and replaced it with a safe dummy string.
-   **UI compliance**: Standardized interactive notices to use strict sentence case in accordance with Obsidian UI guidelines.
-   **Lazy loading implementation**: High-performance settings rendering that only loads section content when its tab is first activated.
-   **Ontology robustness**: Fixed a console error that occurred at startup if ontology folders or files already existed. The plugin now handles existing structures silently and gracefully.
-   **Internal storage migration**: Refactored the `ModelRegistry` to use Obsidian's vault-specific `loadLocalStorage` and `saveLocalStorage` for persistent model caching.
-   **Robust storage interfaces**: Defined the `InternalApp` and `InternalPlugin` interfaces to eliminate `any` casts and ensure strict type safety when accessing internal Obsidian settings.
-   **UI auto-refresh**: Implemented a reactive settings refresh mechanism that updates the UI automatically when background model discovery completes.
-   **Standardized logging**: Refactored model registry and settings logic to use the project's central `logger` utility, removing direct `console` calls.
-   **Concurrency protection**: Added fetching locks to prevent redundant API calls during rapid UI refreshes or plugin re-initialization.
-   **Settings sanitization**: Implemented a boot-time sanitization pass that validates and caps saved context budgets against model-specific limits to prevent configuration corruption.
-   **UI architecture**: Decoupled developer-focused controls into a dedicated `Developer` settings section.
-   **Constant centralization**: Refactored view types, sanitization limits, and model ranking scores into `src/constants.ts` to improve maintainability and eliminate magic numbers.
-   **Architectural documentation**: Enhanced `devs/ARCHITECTURE.md` with detailed Mermaid.js diagrams for Agent control flows and Model selection logic.
-   **Service safety**: Replaced unsafe non-null assertions in `LocalEmbeddingService` with defensive checks to ensure stable task dequeuing.
-   **Service documentation**: Improved JSDoc coverage for core services including `OntologyService`, `GardenerService`, and `SearchOrchestrator` to improve maintainability.
-   **Security masking**: Implemented a recursive masking utility to prevent plaintext API keys from being leaked in developer console debug logs (eg when updating worker configurations).

## [2.2.0] - 2026-01-22

### User features

-   **Multilingual @ Mentions**: Full support for Unicode characters (Korean, Japanese, e.g. Korean `가`) in the `@` mention suggestion box (Resolves #60).
-   **Improved @ Search**: The suggestion box now remains open during selection even when typing spaces or punctuation, allowing easier multi-word file matching.
-   **Recursive Directory Context**: Mentioning a folder with `@` now recursively includes all Markdown files within that directory, ranked by semantic similarity to your query (Resolves #48).
-   **Context-Aware Chat**: The Researcher now automatically includes all visible Markdown files as context when asking questions like "What's this about?". You can now chat with your open notes without needing explicit `@` mentions.
-   **Prioritized @ Suggestions**: The suggestion box now ranks currently visible files at the top of the list, ensuring your active workspace is always easy to reference.
-   **Native Suggestion UI**: Restored native Obsidian icons and improved the suggestion layout for a more premium, integrated feel.
-   **Helpful Chat Guidance**: Added a helpful hint to the chat input and updated system instructions to guide users on using `@` mentions and implicit context.

### Developer features

-   **Robust Context Resolution**: Updated `ResearchChatView` to use `getAbstractFileByPath` for reliable file and folder resolution.
-   **Context Safety**: Implemented explicit context budgeting for recursive folder expansions. The agent now prioritizes relevant files using similarity-based ranking and respects the user's `contextWindowTokens` setting.
-   **Constant Centralization**: Refactored context budget calculations to use centralized `SEARCH_CONSTANTS` for better maintainability.

## [2.1.0] - 2026-01-22

### User features

-   **Folder suggestion in settings**: Introduced an autocomplete folder selector for "Ontology path", "Gardener plans path", and "Excluded folders", making it easier to configure the plugin without manual typing.
-   **Improved excluded folders management**: Redesigned the "Excluded folders" setting into a dynamic list view. You can now easily search for folders to ignore and remove them with a single click.
-   **System instruction reset**: Added a "Reset" button to the advanced settings to easily restore the default agent behaviour and persona.

### Developer features

-   **Reusable folder suggest component**: Implemented `FolderSuggest` (extending `AbstractInputSuggest`) for consistent folder selection across the plugin UI.
-   **Settings refresh utility**: Added a helper to programmatically refresh the Obsidian settings tab, ensuring the UI stays in sync after automated updates.

## [2.0.1] - 2026-01-20

### User features

-   **Unified agentic terminology**: Standardized all major features under a role-based naming convention: **Researcher** for chat and reasoning, **Gardener** for vault hygiene and ontology management, and **Explorer** for similarity search and graph discovery.
-   **Gardener agent for vault hygiene**: Introduced a proactive agent that analyses note metadata and suggests improvements based on a shared ontology. It operates on a "plan-review-apply" model to ensure user oversight and safety.
-   **Centralized ontology management**: Established a formal directory structure (`Concepts`, `Entities`, `MOCs`) and an `Instructions.md` file to guide AI classification, ensuring consistent naming and tagging across the vault.
-   **Interactive hygiene plans**: Refactored the Gardener's output into an interactive markdown interface. Users can now review, select, and apply specific metadata changes directly from the plan note.
-   **Background indexing**: All vector indexing and graph relationship analysis has been offloaded to a dedicated web worker, ensuring the main thread remains responsive even during large vault operations.
-   **High-recall similarity search**: Significantly improved the "similar notes" recall by bypassing Orama's default 80% similarity threshold. You can now see notes with lower similarity scores (down to 1% or whatever your settings specify).
-   **Seamless provider switching**: Fixed a bug where switching between local and Gemini embedding providers would cause "unauthorized access" errors. The plugin now dynamically routes requests to the correct engine instantly.
-   **Model selector dropdowns**: Replaced manual text fields with intuitive dropdown menus for chat, grounding, and code models, pre-populated with the latest Gemini models.
-   **Custom model support**: Added "custom" options for all model categories, providing full control for power users to use specialized or experimental model IDs.
-   **Local model management**: Standardized selection for local embedding models with automatic dimension validation and a new "force re-download" utility for easier troubleshooting.
-   **Improved synchronization**: Refined the indexing engine to detect changes in file size and modification time, ensuring search results are always accurate.
-   **Default code execution**: Changed the default setting for "enable code execution" from **off** to **on**, enabling the computational solver (Python execution) by default for all new installations.

### Developers

-   **Agent service refactoring**: Decomposed the monolithic `AgentService` into specialized `SearchOrchestrator` and `ContextAssembler` components to improve maintainability and allow for independent unit testing.
-   **Safe metadata management**: Implemented a `MetadataManager` service to centralize frontmatter updates, using atomic file operations to prevent race conditions during automated vault maintenance.
-   **Shadow graph infrastructure**: Integrated `graphology` within the indexer worker to track note relationships and wikilinks alongside vector embeddings.
-   **Async indexer worker**: Implemented a Comlink-powered background indexer that manages an Orama vector store and a relationship graph concurrently.
-   **Dynamic routing service**: Implemented `RoutingEmbeddingService` to handle multi-provider delegation, decoupling the graph indexing logic from specific embedding implementations.
-   **Index safety and model tracking**: Enhanced index persistence to track specific embedding model IDs. The plugin now automatically triggers a full re-index if the model is changed, even if dimensions are the same, preventing data corruption.
-   **Strict type safety**: Fully refactored the background worker to eliminate all `any` casts and `eslint-disable` comments, using Orama's native `RawData` types for robust state handling.
-   **Worker robustness**: Implemented a 4-stage stability fallback (Threads -> 1 thread -> No SIMD -> Circuit Breaker) and improved lifecycle management with `fullReset` capabilities.
-   **Boot grace period**: Added a proactive detector that triggers stable modes immediately if the worker crashes within 10 seconds of startup.
-   **Enhanced diagnostics**: Improved worker-side logging for "empty file" scenarios and Orama state migration to help diagnose indexing coverage.
-   **Model hygiene**: Added a `quantized` flag to the `ModelRegistry` to support loading unquantized models (like Potion-8M) and implemented worker-side event loop yielding to prevent 60s timeouts on large files.
-   **Stable mode persistence**: Automatically updates and saves plugin settings when stable modes are triggered to prevent repeat crashes in future sessions.

## [1.5.0] - 2026-01-10

### User features

#### Sovereign intelligence (local + offline)

-   **Zero data leakage:** You can now switch the embedding provider to `Local` in settings. This downloads an open-source model (like _Nomic-Embed_ or _Potion-8M_) to your device, allowing you to index and search your vault without data ever leaving your machine.
-   **Cost savings:** "Similar Notes" and search now work completely free, without consuming your Gemini API quota.

#### Efficiency

-   **Smart indexing:** The plugin now intelligently waits 5 seconds after you stop typing before active re-indexing. This prevents "spamming" the Gemini API with partial edits, significantly reducing your token usage and billing costs.

### Developers

-   **Transformers.js Integration:** Implemented a dedicated Web Worker using `@xenova/transformers` to run ONNX models inside the plugin environment.
-   **Fetch Proxy:** Created a message-passing proxy to route worker network requests through the main process, bypassing strict CORS/CSP policies and sanitizing headers to prevent 401 errors from Hugging Face.
-   **Debounce Refactor:** Consolidated all indexing triggers into a single `VectorStore.requestIndex` method with a `Map<FilePath, Timer>` registry. This prevents race conditions and eliminates redundant "double-debouncing".
-   **Type Safety:** Fixed critical `Float32Array` buffer detachment issues (`copyWithin` errors) during vector storage resizing.
-   **Fine-Tuning:** Added dedicated settings for `queueDelayMs` and `embeddingThreads` to fine-tune performance on different hardware.
-   **Fixed InteliSense errors** in Visual Studio Code. No user impact, but it makes the developer happy. [PR44](https://github.com/cybaea/obsidian-vault-intelligence/pull/44)

## [1.4.0] - 2026-01-03

### Added

-   **Computational solver:** The agent can now write and execute Python code to analyse data from your vault (e.g., _"Read @Monthly Expenses and forecast next month's spend"_).
-   **Settings:** New **Enable code execution** toggle for the Computational Solver above(Default: Off) and corresponding **Code model** selector in the Models tab.
-   **Settings:** New **Context window budget** setting (Default: 200,000 tokens). This allows users to control how much "memory" the agent uses per request, balancing deep context against API rate limits.

### Changed

-   **Settings restructure**:
    -   Settings restructured into logical functional groups (Researcher, Explorer, Gardener).
    -   Models selection moved directly into relevant agent sections.
    -   "Researcher" section now includes chat model, system instructions, and grounding settings.
    -   "Explorer" section consolidates embedding provider, model, and similarity settings.
    -   "Gardener" section (formerly Ontology) now groups hygiene and maintenance settings.
    -   "Advanced" section focused on system performance and technical tuning.
    -   Re-index vault and Refresh model list buttons moved to more contextual locations.
-   **Context engine:** Replaced the static 50,000-character limit per note with a "Greedy Packing" strategy. The agent now reads entire documents whenever the token budget allows, **significantly improving** its ability to understand long reports and avoiding arbitrary cut-offs.

### Developers

-   **Dynamic tools:** Updated `AgentService` to dynamically construct the `tools` array at runtime. This resolves an issue where conditional tools (like the solver) were defined but not correctly passed to the model if disabled.
-   **Response Parsing:** Refactored `GeminiService` to manually parse multi-part responses (`text`, `executableCode`, `codeExecutionResult`), resolving SDK warnings about mixed content types.
-   **Context Limits:** Removed hardcoded `MAX_TOTAL_CONTEXT` constants. Context limits are now calculated dynamically based on the user's `contextWindowTokens` setting.
-   **System Prompt:** Updated the default system prompt to include specific instructions on when and how to utilize the `computational_solver` tool.

## Older versions

Older changes can be found in the repository's [GitHub releases](https://github.com/cybaea/obsidian-vault-intelligence/releases).
