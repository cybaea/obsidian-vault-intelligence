---
name: project
description: Project-specific architecture (Vault Intelligence), services, and maintenance tasks. Load when working on core logic, services, or specific features.
---

# Project Context: Vault Intelligence

This skill contains the domain knowledge for the **Vault Intelligence** Obsidian plugin.

## CRITICAL RULES

1. Use search grounding for EVERY technology decision.
2. Use search grounding EVERYTIME you make a decision about LLM AI models or any Typescript library.

## 1. Project Identity

- **Name**: Vault Intelligence
- **Core Function**: AI-powered Research Agent & Adaptive Hybrid Search.
- **AI Backend**: Google Gemini 3 (via `GeminiService`).
- **Data Structure**: Knowledge Graph + Vector Embeddings (via `GraphService`).

## 2. Architectural Constraints

**Source of Truth**: [devs/ARCHITECTURE.md](devs/ARCHITECTURE.md). (Read this for complex changes. Modify this after complex changes.)

### Critical Rules

1. **Service-Oriented Architecture (SOA)**:
    - **Never** put business logic in Views (UI).
    - **Views** must call **Services** to fetch data or modify the vault.
    - **Services** must be singletons registered in the main plugin class.
2. **No Direct Vault Access in UI**:
    - ❌ `view.app.vault.read()` inside a React component.
    - ✅ `plugin.graphService.getNoteContent()` called by the component.

### Core Services

- **`GeminiService`**: Handles all LLM interactions, context window management, and prompt engineering.
- **`GraphService`**: Manages the graph database, embeddings, and relationship mapping.
- **`SearchService`**: Orchestrates Hybrid Search (Keyword + Semantic).

## 3. Project Structure

- **`src/services/`**: Core business logic (The Brains).
- **`src/views/`**: React/Svelte UI components (The Face).
- **`src/utils/`**: Shared helpers (no state).
- **`devs/`**: Documentation and Architecture Decision Records (ADRs).

## 4. Maintenance & Operations

- **Versioning**: DO NOT bump `package.json` manually. This is handled via the Release Workflow.
- **Manifest**: `id` and `minAppVersion` are strict constraints. Check `obsidian-ref` skill if modifying `manifest.json`.
- **Styling**: All CSS variables must align with Obsidian's theme API. See `styles.css`.

## 5. Common Tasks

- **Adding a Feature**:
    1. Define the Interface in `src/types.ts`.
    2. Implement logic in a Service (`src/services/`).
    3. Expose via `main.ts` if needed.
    4. Build UI in `src/views/`.
