# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

New features are added in the "Unreleased" section. 

## [Unreleased]

### User features

- **Language support**: The Research Assistant now speaks your language! Choose from a list of presets or enter any custom IETF BCP 47 language code (eg `fr-FR`). The `{{LANGUAGE}}` placeholder in system prompts is automatically replaced with your choice.
- **Transient model switching**: Added a model selection dropdown to the Research Chat header, allowing you to temporarily switch models for specific queries without changing global settings.
- **On-the-fly capability toggling**: Added a toggle to the Research Chat header to enable or disable the computational solver for the current session.
- **Improved UI stability**: Fixed a race condition in the chat interface that caused duplicated messages during rapid "Thinking" updates. The "Thinking" indicator now appears instantly for better feedback.
- **"What's New" splash screen**: A beautiful new walkthrough modal that automatically displays release notes after a plugin update, keeping you informed of the latest capabilities.
- **Auto-updating prompts**: System instructions now default to a "managed" state, allowing you to automatically receive improvements to the default persona while still retaining the ability to override them with custom prompts.
- **"Other" language input**: Selecting "Other" in the language dropdown now immediately reveals a text input for custom language codes, ensuring you can use any language supported by the model.
- **System prompt reset**: Added a specific "Reset" button for system instructions to easily revert to the default managed prompt.
- **"Fetch or Fallback" release notes**: Implemented a resilient fetching system that retrieves rich release notes (including images) directly from the GitHub API, with a graceful fallback to a manual link if you are offline.
- **Integrated documentation**: Added direct links to the official VitePress documentation across all settings sections. Each tab now includes section-specific anchors to help users find relevant help articles instantly.
- **Responsive chat header**: The Research Chat controls now wrap gracefully to ensure usability even in narrow sidebars.
- **"Show release notes" command**: A new command to manually open the release notes modal at any time if you want to revisit the latest changes.
- **Stable model aliases**: Updated all default model IDs to use the newest latest aliases (ie gemini-flash-latest), ensuring the plugin always points to the frontier versions.
- **Session reset**: New reset button in the Research Chat header to quickly revert session settings to your global defaults.
- **Sponsor button**: Added a prominent Sponsor button to the release notes modal, styled with GitHub's signature pink outline and dynamically linked to the project's funding configuration.
- **Improved settings visibility**: Refined the placement of documentation links, moving them into subheadings and under section headers for better accessibility and a cleaner UI.
- **Improved documentation clarity**: Clarified API key storage security and ensured consistent British English usage throughout the configuration guide.

### Developer features

- **Dynamic funding resolution**: Implemented a runtime parser for `.github/FUNDING.yml` that automatically synchronises the sponsor link without requiring manual code updates.
- **Per-request agent overrides**: Refactored the AgentService and GeminiService to support optional overrides for model selection and tool enablement inside the Research Chat.
- **Interactive model ID tooltips**: Restored tooltips in the Research Chat model selection dropdown to match the behavior in the main settings.
- **Version upgrade tracking**: Added a previousVersion field to the plugin settings to reliably detect and trigger update-specific UI workflows.
- **Responsive walkthrough UI**: Developed a dedicated `ReleaseNotesModal` using Obsidian's `MarkdownRenderer` and future-proofed it with responsive sizing units and native design tokens.
- **Centralised documentation URLs**: Introduced a structured `DOCUMENTATION_URLS` object in `constants.ts` to manage all external documentation links and anchors in one place. Refactored to follow DRY principles by using hierarchical constants for base and configuration paths.
- **Centralised UI strings**: Refactored the core plugin to use a centralized `UI_STRINGS` constant for all human-readable labels, icons, and tooltips, improving maintainability and consistency.
- **Enhanced API documentation**: Fully synchronised the internal `WorkerAPI` developer documentation with the current implementation and corrected architectural diagrams.
- **Improved JSDoc coverage**: Added detailed inline documentation for core lifecycle methods and service orchestrators to improve developer experience and code readability.
- **Expanded linting suite**: Integrated `stylelint`, `secretlint`, and `markdownlint-cli2` into the CI workflow to ensure high standards for CSS, security, and documentation.
- **Code organisation enforcement**: Added `eslint-plugin-perfectionist` to maintain consistent import sorting and object key ordering.
- **Robust utility refactoring**: Improved the `isSafeUrl` utility with stricter domain validation to prevent potential security regressions in external requests.

## [4.2.0] - 2026-01-27

### User features

- **High-performance graph storage**: Migrated graph and search index storage to MessagePack binary format. This results in up to 80% reduction in file size for large vaults and significantly faster plugin startup times.
- **Improved disk longevity**: Increased auto-save debounce to 30 seconds and implemented a smart "force-save" on plugin shutdown, drastically reducing unnecessary disk writes without risking data loss.
- **Automated privacy protection**: The plugin now automatically manages a nested `.gitignore` for its generated data directory, ensuring large binary index files are never accidentally committed to your repository.
- **Semantic icons**: Updated the ribbon and menu icons to be more descriptive. The researcher now uses a "Message Circle", the Explorer uses a "Grid", and the main ribbon uses a "Brain Circuit".
- **Thinking indicator**: Added a visual pulsing indicator to the chat interface so you know when the agent is "thinking" about your request.

### Developer features

- **Worker-side serialization**: Offloaded MessagePack encoding and vector optimization to a background worker to eliminate UI thread latency during state persistence.
- **Vector packing optimization**: Implemented in-memory casting of embedding arrays to `Float32Array` before serialization, leveraging MessagePack's native binary encoding for near-ideal size efficiency.
- **Defensive binary I/O**: Added buffer-aware slicing to ensure strictly-sized binary writes, preventing file corruption from encoder over-allocation.

## [4.1.1] - 2026-01-27

### User features

### Developer features

- Service routing delegation: Fixed an issue where the "force re-download" button was inactive by implementing proper method delegation in the `RoutingEmbeddingService` wrapper, allowing the UI to access the underlying local service instance.

## [4.1.0] - 2026-01-26

### User features

- **Configurable context engine**: Introduced a new "Search and context tuning" section in Advanced Settings, allowing users to fine-tune the GARS algorithm and context assembly.
- **Structural context pruning**: Implemented intelligent filtering that automatically skips low-relevance results. This restores a clean "3-5 relevant notes" context feel even when search finds dozens of matches.
- **Adjustable relevance thresholds**: Users can now tune the Supporting (snippets) and Structural (headers) thresholds to balance detail vs prompt noise.
- **Search expansion control**: Added a slider to control how many top results trigger graph neighbor expansion, preventing worker congestion on vague queries.
- **Expansion score floor**: Implemented an absolute score safety guard that prevents expanding neighbors for weak/low-confidence search matches.

### Developer features

- **Precision-tuned GARS**: Refined the Graph-Augmented Relevance Score with better spreading activation weights (0.25) and dynamic decay controls.
- **Batch metadata optimization**: Context assembly now uses a single high-efficiency worker call to fetch headers and titles for all results, reducing latency by 95% in large vaults.
- **Context structural cap**: Implemented a hard safety cap for structural (header-only) documents to ensure the agent is never overwhelmed by peripheral metadata.
- **Zero-latency I/O**: Migrated all context file reading to `app.vault.cachedRead` for near-instant assembly from memory.
- **Magic number elimination**: Centralised all internal search and context constants into `src/constants.ts` and exposed them via settings.
- **Domination prevention**: Reduced the single-document soft limit to 10% of total budget to ensure a more diverse context window.

## [4.0.1] - 2026-01-26

### User features

### Developer features

## [4.0.0] - 2026-01-25

### User features

- **GARS tuning**: Users can now precisely adjust the similarity, centrality, and activation weights in settings to fine-tune how the Research Assistant ranks notes.
- **Graph & ontology awareness**: The Research Assistant now understands vault hierarchy through a new topic sibling traversal algorithm, finding related notes even if they are not directly linked.
- **Improved hybrid search**: Combined vector and graph analysis into a unified scoring system (GARS) for more relevant search results.
- **Adaptive context assembler**: Implemented an "Accordion" strategy that packs more context into the AI memory by intelligently switching between full text, snippets, and metadata based on relevance.
- **Comprehensive documentation**: Added a new user guide for the Researcher and a deep technical specification for developers.
- **Improved error feedback**: The Research Assistant and settings now provide friendly, actionable messages for authentication issues (eg "Invalid API key") instead of technical status codes or generic apologies.
- **Reliable indexing alerts**: Background vault indexing now correctly reports critical failures (like expired API keys) to the user interface, preventing silent failures during re-indexing.
- **Context transparency**: The Research Assistant now displays a collapsible list of all "Context Documents" used to generate the answer (Resolves #59).
- **Interactive references**: Context documents in the chat reference list are clickable (to open the note) and draggable (to insert a link into other notes).
- **Dynamic model fetching**: The plugin now dynamically retrieves available Gemini models from the Google API, ensuring support for the latest model versions without plugin updates.
- **Smart model caching**: Added configurable caching for the Gemini model list to ensure a snappy settings experience while keeping the list fresh.
- **Instant connection**: Providing a valid Gemini API key now immediately triggers a model fetch and enables model dropdowns without needing a plugin restart.
- **Model tooltips**: Added hover tooltips to all model dropdowns showing the raw Gemini model ID for advanced users.
- **Improved model sorting**: Model lists are now intelligently sorted to prioritize the latest Gemini versions (eg Gemini 3.0 and 2.5 families).
- **Refined model lists**: Cleaned up dropdown menus by excluding experimental and device-bound (Nano) models by default.
- **Grounding optimisation**: Specifically restricted grounding models to Flash and Lite variants for the best balance of speed and cost during web search workflows.
- **Model list debugging**: Added a "Log items" utility in the Developer section to print the raw Gemini API response to the console, with automatic fresh fetch if data is missing.
- **Dynamic budget scaling**: Context budgets now automatically adjust when switching models to maintain a consistent capacity ratio.
- **Tabbed settings interface**: Refactored the settings UI into a clean, tabbed layout (Connection, Researcher, Explorer, Gardener, and Advanced).
- **Improved settings architecture**: Centralised tab rendering logic and standardised agent sections using a unified `SettingsTabContext`.
- **Proportional reset buttons**: Added "Reset to default ratio" buttons to context budgets, restoring them to sensible baselines (20% for chat, 10% for gardener) based on the current model's limit.
- **Persistent debugging**: Updated the model registry to persist raw API responses in local storage for a more reliable troubleshooting experience across restarts.
- **UI layout optimization**: Moved the Gardener model selection to sit directly above its corresponding budget setting for a more intuitive configuration flow.

### Developer features

- **GARS mathematical model**: Formalized the graph-augmented relevance score calculation in `ScoringStrategy.ts`.
- **Dynamic ontology config**: Propagated `ontologyPath` settings to the background worker to ensure traversal logic respects custom folder structures.
- **Shadow graph specification**: Created a deep technical document (`devs/shadow-graph-technical.md`) covering architecture, pipelines, and algorithms.
- **UI standardisation**: Refined settings labels and messages to strictly follow sentence case for a more native feel.
- **Critical error propagation**: Updated the Indexer Web Worker to explicitly re-throw authentication and API errors back to the main thread.
- **Throwing model discovery**: Enhanced `ModelRegistry.fetchModels` with an optional `throwOnError` flag to allow UI-driven error handling during model refreshes.
- **Security hardening**: Removed a leaked API key from the test suite and replaced it with a safe dummy string.
- **UI compliance**: Standardised interactive notices to use strict sentence case in accordance with Obsidian UI guidelines.
- **Lazy loading implementation**: High-performance settings rendering that only loads section content when its tab is first activated.
- **Ontology robustness**: Fixed a console error that occurred at startup if ontology folders or files already existed. The plugin now handles existing structures silently and gracefully.
- **Internal storage migration**: Refactored the `ModelRegistry` to use Obsidian's vault-specific `loadLocalStorage` and `saveLocalStorage` for persistent model caching.
- **Robust storage interfaces**: Defined the `InternalApp` and `InternalPlugin` interfaces to eliminate `any` casts and ensure strict type safety when accessing internal Obsidian settings.
- **UI auto-refresh**: Implemented a reactive settings refresh mechanism that updates the UI automatically when background model discovery completes.
- **Standardised logging**: Refactored model registry and settings logic to use the project's central `logger` utility, removing direct `console` calls.
- **Concurrency protection**: Added fetching locks to prevent redundant API calls during rapid UI refreshes or plugin re-initialization.
- **Settings sanitization**: Implemented a boot-time sanitization pass that validates and caps saved context budgets against model-specific limits to prevent configuration corruption.
- **UI architecture**: Decoupled developer-focused controls into a dedicated `Developer` settings section.
- **Constant centralisation**: Refactored view types, sanitisation limits, and model ranking scores into `src/constants.ts` to improve maintainability and eliminate magic numbers.
- **Architectural documentation**: Enhanced `devs/ARCHITECTURE.md` with detailed Mermaid.js diagrams for Agent control flows and Model selection logic.
- **Service safety**: Replaced unsafe non-null assertions in `LocalEmbeddingService` with defensive checks to ensure stable task dequeuing.
- **Service documentation**: Improved JSDoc coverage for core services including `OntologyService`, `GardenerService`, and `SearchOrchestrator` to improve maintainability.
- **Security masking**: Implemented a recursive masking utility to prevent plaintext API keys from being leaked in developer console debug logs (eg when updating worker configurations).

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
