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