# Vault Intelligence: Architecture and standards (2026 Edition)

> **Status**: Validated & Active
> **Last Updated**: February 2026
> **Context**: This document serves as the authoritative source of truth for both human developers and AI agents (Gemini 3) working on the Vault Intelligence plugin.

## 1. Core Philosophy & Identity

*   **Identity**: Vault Intelligence is an AI-powered Research Agent and Adaptive Hybrid Search tool.
*   **AI Backend**: Google Gemini 3 (via `GeminiService`). _Note: Requires strict context window management._
*   **Data Structure**: Knowledge Graph + Vector Embeddings (via `GraphService`).
*   **Platform**: Obsidian (Desktop and Mobile). _Note: Linux/Wayland support is now default in Electron v39 (Jan 2026)._

## 2. Architectural Patterns (Strict SOA)

We strictly adhere to a **Service-Oriented Architecture (SOA)** to ensure testability and separation of concerns.

### 2.1 The Golden Rules

1.  **Services are Singletons**: All core logic resides in `src/services/`. Services must be instantiated once in `main.ts` and passed via dependency injection or accessed via the plugin instance.
2.  **Views are Dumb**: UI components (`src/views/`) **MUST NOT** contain business logic.
    *   **Anti-pattern (Avoid)**: `view.app.vault.read()`
    *   **Recommended pattern**: `plugin.graphService.getNoteContent()`
3.  **No Global State**: Avoid `window.app`. Always use `this.app` passed through the plugin instance.

### 2.2 Service Responsibilities

*   **`GeminiService`**: Manages LLM interactions. _New 2026 Req: Must use `SecretStorage` for API keys._
*   **`GraphService`**: Manages the localized knowledge graph and vector store.
*   **`SearchService`**: Orchestrates Hybrid Search (combining keyword and semantic results).
*   **`PersistenceManager`**: Handles all file I/O for plugin state (eg `.vault-intelligence/`).

## 3. Obsidian Development Standards (2026 Grounded)

All code must adhere to the latest Obsidian API standards.

### 3.1 API and security

*   **Secret Management**: Use `SecretStorage` (API v1.9+, Jan 2026) for storing API keys (Gemini API Key). **Do not** store secrets in `data.json` or plain styling settings.
*   **Settings UI**: Use `SettingGroup` (API v1.9+) to organize settings instead of manual headings.
*   **File Access**:

    *   Use `app.vault.getAbstractFileByPath()` for file resolution.
    *   Use `app.fileManager.processFrontMatter()` for metadata updates (never regex-replace the file content directly).
    *   **Performance**: Use `cachedRead` where possible for read-heavy operations.

### 3.2 Coding Conventions (TypeScript)

*   **Modern JS**: Strict use of `const`/`let`, `async`/`await`. No `var`.
*   **Type Safety**: No `any`. Use strict interfaces for all Service inputs/outputs.
*   **Validation**: All user input (paths, file names) must be sanitized using `normalizePath()`.

### 3.3 UI/UX standards

*   **Style**: Strongly prefer Obsidian CSS variables (eg `--color-red`); use custom variables only when necessary and with proper justification.

*   **Copy**: Use sentence case for all UI strings.
*   **Responsiveness**: Ensure views work on mobile (touch targets, layout shifts).

## 4. Operational Guardrails

### 4.1 AI Agent Rules

1.  **Verification**: Always run `npm run lint`, `npm run build`, `npm run test` and `npm run docs:build` before marking a coding task as complete.

### 4.2 Release Readiness

*   **Manifest**: `minAppVersion` should be updated if using new APIs (e.g. `1.9.0` for `SecretStorage`).
*   **Performance**: `onload` must complete in <100ms. Defer heavy initialization (graph loading) to `onLayoutReady`.

## 5. References

1.  [Obsidian API Documentation](https://github.com/obsidianmd/obsidian-api)
2.  [ESLint Rules](https://github.com/obsidianmd/eslint-plugin)
3.  See `devs/REFERENCE_LINKS.md` for external 2026 resources.
