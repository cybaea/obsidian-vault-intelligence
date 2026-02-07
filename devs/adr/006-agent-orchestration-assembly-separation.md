# ADR-006: Separation of agent orchestration and context assembly

## Status

Accepted

## Context

The `AgentService` was originally responsible for everything: managing the chat loop, coordinating tool execution, performing searches, and assembling the context from those search results. As the plugin's features grew (hybrid search, complex context window management, "Gardener" capabilities), `AgentService` became a massive "God Object". This made it difficult to maintain, test, and adapt for different types of agentic behaviour.

Specifically, the `VAULT_SEARCH` tool implementation contained logic for:

1.  Hybrid search (merging vector and keyword matches).
2.  Ranking and scoring results.
3.  Reading files and clipping content to fit within token budgets.
4.  Ensuring diverse context (preventing one large file from starving others).

## Decision

We refactored `AgentService` by decomposing its core responsibilities into two new specialized services:

*   **`SearchOrchestrator`**: Manages the "Search" logic. It coordinates the `GraphService` (for vector search) and local keyword matching, then merges and ranks the results using a `ScoringStrategy`.
*   **`ContextAssembler`**: Manages the "Assembly" logic. It takes ranked search results and builds a text block for the LLM, handling character budgets, starvation protection, and smart windowing for large files.

`AgentService` now acts as a high-level orchestrator that delegates to these services within the tool execution flow.

## Consequences

### Positive

*   **Improved maintainability**: `AgentService` is significantly smaller and focused purely on LLM communication and tool routing.
*   **Testability**: `SearchOrchestrator` and `ContextAssembler` can be unit-tested without an active LLM connection.
*   **Extensibility**: New search strategies or context assembly rules can be implemented in their respective services without risking breakage in the core chat loop.
*   **DRY code**: Other components (like the Gardener) can repurpose these services for vault analysis.

### Negative

*   **Component proliferation**: More files and classes to track in the codebase.
*   **Dependency injection complexity**: Requires more careful orchestration in `main.ts` to wire services together.
