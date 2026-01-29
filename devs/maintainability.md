# Best Practices for Maintainable Obsidian Plugins

This document outlines key strategies and patterns to ensure the long-term maintainability of Obsidian plugins. It focuses on reducing technical debt, managing complexity, and ensuring the plugin remains robust as the Obsidian API and user requirements evolve.

## 1. Code Structure & Organization

### Separation of Concerns

* **Services vs. UI:** Keep business logic (e.g., embedding generation, vector storage) completely separate from UI code (Views, Modals). Services should not import UI components.
* **Workers:** Offload heavy computational tasks (like embedding generation) to Web Workers to prevent freezing the Obsidian UI.
* **dependency Injection:** Pass dependencies (like `App`, `Settings`) into classes via their constructor rather than relying on global state. This makes unit testing easier.

### Constants & Configuration

* **No Magic Numbers:** Never use hardcoded numbers or strings in logic code.
    * **Bad:** `if (score > 0.85) ...`
    * **Good:** `if (score > CONSTANTS.SEARCH.STRICT_MATCH_THRESHOLD) ...`
* **User Configurable:** If a value might change based on user preference or hardware capability (e.g., timeout durations, cache sizes, model parameters), expose it in `Settings`.
* **Centralized Constants:** For values that are not user-configurable but might need tuning (e.g., internal buffer sizes), store them in a dedicated `constants.ts` file.

## 2. State & Data Management

### File System Interaction

* **Robust Change Detection:** relying solely on `mtime` (modified time) can be risky with sync tools (Git, Obsidian Sync) that might preserve timestamps.
    * **Recommendation:** Use `mtime` AND `size` for quick checks. For critical data integrity, consider storing a content hash (CRC32 or simple hash) in your index.
* **Deboucing:** When listening to `vault.on('modify')`, always debounce updates. Users often save frequently or plugins auto-save, triggering multiple events.
* **Atomic Writes:** When saving data (like a vector index), write to a temporary file first and then rename it to the target filename to prevent corruption during crashes.

### API & Network

* **Typed Responses:** Always type API responses. Do not rely on `any`.
* **Status Codes:** Check HTTP status codes as numbers (e.g., `res.status === 429`), not by parsing error strings.
* **Backoff & Retry:** Implement exponential backoff for all network requests.
* **Centralized Fetching:** Wrap `requestUrl` or `fetch` in a unified service to handle headers, timeouts, and error logging consistently.

## 3. Future Proofing

### Model & API Independence

* **Model Agnostic:** Design your system to handle multiple models. File extensions, context window sizes, and dimension capabilities should be dynamic properties of a `Model` object, not hardcoded in the logic.
* **Dynamic Resources:** Avoid hardcoding versions or URLs for external scripts (like CDNs). Define these in a configuration object that can be updated easily or even fetched from a remote "latest versions" file if appropriate.

### Clean Code

* **Linting:** Enforce strict TypeScript rules (no `any`). Use ESLint with specific rules for Obsidian (e.g., `no-process-env`).
* **Comments:** Comment _why_ a complex logic exists, not just what it does.
* **Logging:** Use a logger wrapper that can be toggled to different verbosity levels by the user.

## 4. Specific Patterns for This Plugin

### Search Logic & Scoring Strategy

Complex heuristic scoring is isolated in the `ScoringStrategy.ts` class.

* **Modular Heuristics:** Match types (Title, Exact Body, Fuzzy Bag-of-Words) are calculated via dedicated methods.
* **Tuning:** Weights and thresholds for these heuristics are stored in `src/constants.ts` under `SEARCH_CONSTANTS`.
* **Hybrid Boosting:** Merging vector and keyword results uses `ScoringStrategy.boostHybridResult()` to ensure consistent logic across the search pipeline.

### Embeddings & Vector Storage

* **Robust Change Detection:** `VectorStore.ts` checks both `mtime` and `size` to detect file modifications, ensuring parity with sync tools.
* **Dimensions:** Always read `dimensions` from the `IEmbeddingService` or the `VectorIndex`, never hardcode.
* **Backoff:** Network failures (especially HTTP 429) trigger a centralized backoff in `VectorStore.ts` using `EMBEDDING_CONSTANTS.BACKOFF_DELAY_MS`.

### Centralized Configuration

* **`src/constants.ts`:** Holds all internal "magic numbers" (timeouts, character budgets, scoring weights).
* **`src/services/ModelRegistry.ts`:** Acts as the single source of truth for supported AI models and their capabilities (dimensions, provider).
* **Worker Injection:** CDN URLs and versions for Web Workers are injected from `WORKER_CONSTANTS` at runtime, avoiding hardcoded strings in the worker scripts.

### Dependency Locking & Version Synchronization

Special care must be taken with hybrid dependencies like `@xenova/transformers`, which require local NPM packages to be in sync with remote WASM/CDN assets.

* **Pinned Versions:** Always use exact versions (no `^` or `~`) in `package.json` for libraries that fetch remote assets for specialized environments (e.g., workers).
* **Three-Way Validation:** We use `scripts/validate-dependencies.cjs` to ensure:
    1. `package.json` matches the installed `node_modules`.
    2. `src/constants.ts` (`WASM_VERSION` and `WASM_CDN_URL`) matches `package.json`.
    3. The remote CDN assets are reachable and correctly versioned.
* **Update Flow:** To upgrade `@xenova/transformers`:
    1. Simply run `npm run upgrade-transformers`. This script will:
        * Fetch the latest version from NPM.
        * Update `package.json` and `src/constants.ts` automatically.
        * Run `npm install`.
        * Verify CDN reachability and code sync.
    2. Review the changes and commit.

## 5. Maintenance Checklist (Annual/Per-Update)

* [ ] Run `node scripts/validate-dependencies.cjs` to ensure version parity.
* [ ] Review `manifest.json` `minAppVersion`.
* [ ] Audit dependencies (npm audit).
* [ ] Check for deprecated Obsidian API usage.
* [ ] Review all `TODO` and `FIXME` comments.
