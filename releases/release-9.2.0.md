# 9.2.0 — Vault Hygiene and Stability

This release focuses on vault organisation and system stability. As your knowledge base grows, it naturally accumulates duplicate ideas and abandoned notes. We have expanded the Gardener to detect and resolve these issues automatically. Alongside these new capabilities, we have fixed memory leaks and implemented important security updates to the Model Context Protocol (MCP) clients.

## Gardener Semantic Merging

You can now use the Gardener to intelligently detect identical and duplicate topics in your ontology. Rather than just finding exact text matches, the Gardener uses a triple-detection system combining lexical, structural, and semantic vector checks to identify conceptual duplicates.

Crucially, this is designed with safety in mind. Merging topics uses Obsidian's intelligent parsing to rewrite links throughout your vault without breaking references. All discovered merges are presented in an interactive card, giving you full oversight before any files are modified.

## Gardener Orphan Pruning

Knowledge bases naturally accumulate cruft over time. The Gardener now mathematically detects abandoned topic notes that have no incoming links (either via wikilinks or frontmatter). It will propose these orphans for _archive or deletion_, helping to keep your vault cleanly structured and focused on active concepts.

## Hardened Security and Performance

This update includes major refactoring under the hood to ensure Vault Intelligence remains rock solid as you scale your knowledge base:

-   **Memory leak mitigation**: Resolved multiple memory leaks in the local embedding service and Model Context Protocol (MCP) clients, preventing slowdowns during extended sessions.
-   **Server-Side Request Forgery (SSRF) protection**: Hardened the URL utility against SSRF attacks leveraging DNS rebinding, ensuring external requests are strictly enforced over HTTPS.
-   **Command injection prevention**: Fixed a critical vulnerability in the MCP client manager, replacing shell-based process execution with safe argument-array process spawning.
-   **Worker back-pressure handling**: Implemented a robust mechanic in the indexing pipeline to safely buffer vault events during worker restarts, ensuring zero data loss during configuration changes.
-   **GraphSyncOrchestrator refactoring**: Decomposed the monolithic orchestrator into specialized services to dramatically improve maintainability.

## Polish and Quality of Life

-   **Ollama streaming reliability**: Fixed a critical bug where native Ollama tool calls spanning across chunk boundaries would fail to parse.
-   **Regex ReDoS prevention**: Hardened the mention extraction regex against catastrophic backtracking vulnerabilities.
-   **Settings expansion**: Exposed powerful settings including Dual-Loop Search controls, Orphan Management logic, and Search Centrality logic.
-   **Configuration documentation**: Completely overhauled the configuration documentation with outcome-oriented explanations, deep troubleshooting links, and standardized terminology.

_Note: This release will trigger a full re-indexing of your vault on the next workspace load, which may consume AI tokens if you are using a cloud-based embedding model._
