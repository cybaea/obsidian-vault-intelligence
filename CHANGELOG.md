# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### User features

- **Context Transparency**: The Research Assistant now displays a collapsible list of all "Context Documents" used to generate the answer (Resolves #59).
- **Interactive References**: Context documents in the chat reference list are clickable (to open the note) and draggable (to insert a link into other notes).
- **Dynamic Model Fetching**: The plugin now dynamically retrieves available Gemini models from the Google API, ensuring support for the latest model versions without plugin updates.
- **Smart Model Caching**: Added configurable caching for the Gemini model list to ensure a snappy settings experience while keeping the list fresh.
- **Instant Connection**: Providing a valid Gemini API key now immediately triggers a model fetch and enables model dropdowns without needing a plugin restart.
- **Model Tooltips**: Added hover tooltips to all model dropdowns showing the raw Gemini model ID for advanced users.
- **Improved Model Sorting**: Model lists are now intelligently sorted to prioritize the latest Gemini versions (e.g., Gemini 3.0 and 2.5 families).
- **Refined Model Lists**: Cleaned up dropdown menus by excluding experimental and device-bound (Nano) models by default.
- **Grounding Optimisation**: Specifically restricted grounding models to Flash and Lite variants for the best balance of speed and cost during web search workflows.
- **Model List Debugging**: Added a "Log items" utility in the Developer section to print the raw Gemini API response to the console, with automatic fresh fetch if data is missing.
- **Dynamic Budget Scaling**: Context budgets now automatically adjust when switching models to maintain a consistent capacity ratio.
- **Tabbed Settings Interface**: Refactored the settings UI into a clean, tabbed layout (Connection, Researcher, Explorer, Gardener, and Advanced).
- **Improved Settings Architecture**: Centralised tab rendering logic and standardised agent sections using a unified `SettingsTabContext`.
- **Proportional Reset Buttons**: Added "Reset to default ratio" buttons to context budgets, restoring them to sensible baselines (20% for chat, 10% for gardener) based on the current model's limit.
- **Persistent Debugging**: Updated the model registry to persist raw API responses in local storage for a more reliable troubleshooting experience across restarts.
- **UI Layout Optimization**: Moved the Gardener model selection to sit directly above its corresponding budget setting for a more intuitive configuration flow.


### Developer features

- **Lazy Loading Implementation**: High-performance settings rendering that only loads section content when its tab is first activated.
- **Ontology Robustness**: Fixed a console error that occurred at startup if ontology folders or files already existed. The plugin now handles existing structures silently and gracefully.
- **Internal Storage Migration**: Refactored the `ModelRegistry` to use Obsidian's vault-specific `loadLocalStorage` and `saveLocalStorage` for persistent model caching.
- **Robust Storage Interfaces**: Defined the `InternalApp` and `InternalPlugin` interfaces to eliminate `any` casts and ensure strict type safety when accessing internal Obsidian settings.
- **UI Auto-Refresh**: Implemented a reactive settings refresh mechanism that updates the UI automatically when background model discovery completes.
- **Standardised Logging**: Refactored model registry and settings logic to use the project's central `logger` utility, removing direct `console` calls.
- **Concurrency Protection**: Added fetching locks to prevent redundant API calls during rapid UI refreshes or plugin re-initialization.
- **Settings Sanitization**: Implemented a boot-time sanitization pass that validates and caps saved context budgets against model-specific limits to prevent configuration corruption.
- **UI Architecture**: Decoupled developer-focused controls into a dedicated `Developer` settings section.
- **Constant Centralization**: Refactored context budget ratios and search scoring heuristics to use centralized constants in `src/constants.ts`.
- **Architectural Documentation**: Comprehensive update to `devs/ARCHITECTURE.md` with detailed Mermaid.js data flows, control flows, and service interface definitions.
- **Worker Robustness**: Replaced unsafe non-null assertions in the embedding worker with defensive null checks to prevent runtime exceptions during model configuration.
- **Service Documentation**: Added comprehensive Inline JSDoc and strict access modifiers to core services like `ModelRegistry` to improve code clarity and maintainability.
- **Security Masking**: Implemented a recursive masking utility to prevent plaintext API keys from being leaked in developer console debug logs (e.g. when updating worker configurations).


## [2.2.0] - 2026-01-22

### User features

- **Multilingual @ Mentions**: Full support for Unicode characters (Korean, Japanese, e.g. Korean `가`) in the `@` mention suggestion box (Resolves #60).
- **Improved @ Search**: The suggestion box now remains open during selection even when typing spaces or punctuation, allowing easier multi-word file matching.
- **Recursive Directory Context**: Mentioning a folder with `@` now recursively includes all Markdown files within that directory, ranked by semantic similarity to your query (Resolves #48).
- **Context-Aware Chat**: The Researcher now automatically includes all visible Markdown files as context when asking questions like "What's this about?". You can now chat with your open notes without needing explicit `@` mentions.
- **Prioritized @ Suggestions**: The suggestion box now ranks currently visible files at the top of the list, ensuring your active workspace is always easy to reference.
- **Native Suggestion UI**: Restored native Obsidian icons and improved the suggestion layout for a more premium, integrated feel.
- **Helpful Chat Guidance**: Added a helpful hint to the chat input and updated system instructions to guide users on using `@` mentions and implicit context.

### Developer features

- **Robust Context Resolution**: Updated `ResearchChatView` to use `getAbstractFileByPath` for reliable file and folder resolution.
- **Context Safety**: Implemented explicit context budgeting for recursive folder expansions. The agent now prioritizes relevant files using similarity-based ranking and respects the user's `contextWindowTokens` setting.
- **Constant Centralization**: Refactored context budget calculations to use centralized `SEARCH_CONSTANTS` for better maintainability.

## [2.1.0] - 2026-01-22

### User features

- **Folder suggestion in settings**: Introduced an autocomplete folder selector for "Ontology path", "Gardener plans path", and "Excluded folders", making it easier to configure the plugin without manual typing.
- **Improved excluded folders management**: Redesigned the "Excluded folders" setting into a dynamic list view. You can now easily search for folders to ignore and remove them with a single click.
- **System instruction reset**: Added a "Reset" button to the advanced settings to easily restore the default agent behaviour and persona.

### Developer features

- **Reusable folder suggest component**: Implemented `FolderSuggest` (extending `AbstractInputSuggest`) for consistent folder selection across the plugin UI.
- **Settings refresh utility**: Added a helper to programmatically refresh the Obsidian settings tab, ensuring the UI stays in sync after automated updates.

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

### User features

#### Sovereign intelligence (local + offline)

- **Zero data leakage:** You can now switch the embedding provider to `Local` in settings. This downloads an open-source model (like _Nomic-Embed_ or _Potion-8M_) to your device, allowing you to index and search your vault without data ever leaving your machine.
- **Cost savings:** "Similar Notes" and search now work completely free, without consuming your Gemini API quota.

#### Efficiency

- **Smart indexing:** The plugin now intelligently waits 5 seconds after you stop typing before active re-indexing. This prevents "spamming" the Gemini API with partial edits, significantly reducing your token usage and billing costs.

### Developers

- **Transformers.js Integration:** Implemented a dedicated Web Worker using `@xenova/transformers` to run ONNX models inside the plugin environment.
- **Fetch Proxy:** Created a message-passing proxy to route worker network requests through the main process, bypassing strict CORS/CSP policies and sanitizing headers to prevent 401 errors from Hugging Face.
- **Debounce Refactor:** Consolidated all indexing triggers into a single `VectorStore.requestIndex` method with a `Map<FilePath, Timer>` registry. This prevents race conditions and eliminates redundant "double-debouncing".
- **Type Safety:** Fixed critical `Float32Array` buffer detachment issues (`copyWithin` errors) during vector storage resizing.
- **Fine-Tuning:** Added dedicated settings for `queueDelayMs` and `embeddingThreads` to fine-tune performance on different hardware.
- **Fixed InteliSense errors** in Visual Studio Code. No user impact, but it makes the developer happy. [PR44](https://github.com/cybaea/obsidian-vault-intelligence/pull/44)


## [1.4.0] - 2026-01-03

### Added

- **Computational solver:** The agent can now write and execute Python code to analyse data from your vault (e.g., _"Read @Monthly Expenses and forecast next month's spend"_).
- **Settings:** New **Enable code execution** toggle for the Computational Solver above(Default: Off) and corresponding **Code model** selector in the Models tab.
- **Settings:** New **Context window budget** setting (Default: 200,000 tokens). This allows users to control how much "memory" the agent uses per request, balancing deep context against API rate limits.

### Changed

- **Settings restructure**:
  - Settings restructured into logical functional groups (Researcher, Explorer, Gardener).
  - Models selection moved directly into relevant agent sections.
  - "Researcher" section now includes chat model, system instructions, and grounding settings.
  - "Explorer" section consolidates embedding provider, model, and similarity settings.
  - "Gardener" section (formerly Ontology) now groups hygiene and maintenance settings.
  - "Advanced" section focused on system performance and technical tuning.
  - Re-index vault and Refresh model list buttons moved to more contextual locations.
- **Context engine:** Replaced the static 50,000-character limit per note with a "Greedy Packing" strategy. The agent now reads entire documents whenever the token budget allows, **significantly improving** its ability to understand long reports and avoiding arbitrary cut-offs.

### Developers

- **Dynamic tools:** Updated `AgentService` to dynamically construct the `tools` array at runtime. This resolves an issue where conditional tools (like the solver) were defined but not correctly passed to the model if disabled.
- **Response Parsing:** Refactored `GeminiService` to manually parse multi-part responses (`text`, `executableCode`, `codeExecutionResult`), resolving SDK warnings about mixed content types.
- **Context Limits:** Removed hardcoded `MAX_TOTAL_CONTEXT` constants. Context limits are now calculated dynamically based on the user's `contextWindowTokens` setting.
- **System Prompt:** Updated the default system prompt to include specific instructions on when and how to utilize the `computational_solver` tool.

## Older versions

Older changes can be found in the repository's [GitHub releases](https://github.com/cybaea/obsidian-vault-intelligence/releases).