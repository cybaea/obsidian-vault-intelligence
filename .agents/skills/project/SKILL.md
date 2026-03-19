---
name: project
description: Project-specific architecture (Vault Intelligence), services, and maintenance tasks. Load when working on core logic, services, or specific features.
---

# Project Context: Vault Intelligence

This skill contains the domain knowledge for the **Vault Intelligence** Obsidian plugin.

## CRITICAL RULES

1.  Use search grounding for EVERY technology decision.
2.  Use search grounding EVERY TIME you make a decision about LLM AI models or any Typescript library.
3.  Strict adherence to Obsidian API v1.11.4+ standards (e.g., `SecretStorage` for keys, `SettingGroup` for UI).
4.  **2026 UX/Security Practices**: Avoid global `app` instance (use `this.app`), avoid `innerHTML`/`insertAdjacentHTML` (use `createEl`), use `Editor` API for active note modifications.

## 1. Project Identity

-   **Name**: Vault Intelligence
-   **Core Function**: AI-powered Research Agent & Adaptive Hybrid Search.
-   **AI Backend**: Provider-agnostic via `IReasoningClient` & `IEmbeddingClient` (Default: `GeminiProvider`, Fallback: `OllamaProvider`). Managed by `ProviderRegistry`.
-   **Data Structure**: Knowledge Graph + Vector Embeddings (via `GraphService` and Indexer Web Worker).

## 2. Architectural Constraints

**Source of Truth**: [devs/ARCHITECTURE.md](devs/ARCHITECTURE.md). (Read this for complex changes. Modify this after complex changes.)

### Critical Rules

1.  **Service-Oriented Architecture (SOA)**:
    -   **Never** put business logic in Views (UI).
    -   **Views** (`src/views/`) are dumb and must call **Services** to fetch data or modify the vault.
    -   **Services** must be singletons instantiated in `main.ts` and passed via dependency injection.
2.  **No Direct Vault Access in UI**:
    -   ❌ `view.app.vault.read()` inside a View component.
    -   ✅ `plugin.graphService.getNoteContent()` or `app.vault.getAbstractFileByPath()` for simple resolution.
    -   Use `app.fileManager.processFrontMatter()` for metadata updates, never direct regex replacement.

### Core Services

-   **`AgentService`**: Orchestrates chat, tool execution, and context assembly.
-   **`ProviderRegistry`**: Central manager for AI model providers (`GeminiProvider`, `OllamaProvider`).
-   **`GraphService`**: Manages the localized knowledge graph, vector store, and Web Worker communication.
-   **`SearchOrchestrator`**: Orchestrates Hybrid Search (keyword + semantic).
-   **`GardenerService`**: Proactive vault hygiene and metadata management via Ontology context.
-   **`PersistenceManager`**: Handles file I/O for plugin state.

## 3. Project Structure

-   **`src/services/`**: Core business logic (The Brains).
-   **`src/views/`**: Native DOM UI components (The Face). No React.
-   **`src/utils/`**: Shared helpers (no state).
-   **`src/workers/`**: Web Worker for heavy lifting (Orama index, Graphology).
-   **`devs/`**: Documentation and Architecture Decision Records (ADRs).

## 4. Maintenance & Operations

-   **Versioning**: DO NOT bump `package.json` manually. This is handled via the Release Workflow.
-   **Manifest**: `minAppVersion` must reflect API usage (e.g., `1.11.4` for `SecretStorage`). Check `obsidian-ref` skill if modifying `manifest.json`.
-   **Styling**: Strongly prefer Obsidian CSS variables (e.g. `--color-red`); use custom variables only when necessary.
-   **Copy**: Use sentence case for all UI strings.
-   **Validation**: Sanitize user input (paths, file names) using `normalizePath()`.

## 5. Common Tasks

-   **Adding a Feature**:
    1.  Define the Interface in `src/types.ts`.
    2.  Implement logic in a Service (`src/services/`).
    3.  Expose via `main.ts` if needed (Dependency Injection).
    4.  Build UI in `src/views/` (Native DOM, responsive design).
-   **Accessing GitHub**:
    1.  You can use the `gh` command-line tool to access GitHub.
