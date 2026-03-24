# 9.1 — The Gardener's Evolution

Vault Intelligence is a different AI plugin for Obsidian. It transforms your vault into a dynamic, self-maintaining knowledge system. It goes beyond simple Q&A by introducing agents that maintain your vault's structure, retrieve information based on your explicit connections, and ground your knowledge in the real world.

With 9.1, we are doubling down on our core differentiator: **The Gardener**. 

This release introduces significant optimizations for vault hygiene, respects how you physically organise your data, and deepens our native external search grounding.

## Folders as Semantic Context

Until now, our Graph-Augmented Relevance Scoring (GARS) relied entirely on explicit `topics:` links. This worked beautifully for meticulous curators but frustrated structural thinkers—those who rely on strict folder hierarchies (like `Work` vs `Personal`) to organise their minds.

With 9.1.0, we introduce **Implicit Folder Semantics**. The Gardener and the Graph Engine can now treat your directory structure as native semantic information. By default, if a folder matches an existing ontology topic (e.g., your `Projects/Vault-Intelligence` folder matches your `Vault-Intelligence` topic), the engine understands the relationship implicitly without needing manual tags on every file. You can also configure it to treat *every* folder as a semantic topic. It's a massive expansion of graph accuracy with zero extra effort on your part.

## The Gardener Optimizer

A proactive maintenance agent should save you time, not create busywork. Previously, running the Gardener on a mature vault meant sifting through hundreds of "no updates" just to find the few new notes that actually needed tagging.

We've created a preprocessing engine to eliminate this friction. The new **Gardener: organize vault concepts (new files only)** command intelligently filters your vault *before* analysis. It completely skips files that are already aligned with your ontology, focusing exclusively on "needy" documents—orphaned notes, missing tags, or broken structures. This eliminates the noise of sorting through unchanged files, while also drastically reducing execution time and API costs.

## Native Link Reading & Web Grounding

Vault Intelligence has always merged internal vault context with external web grounding. 9.1.0 enhances this by introducing **Native Link Reading** for Gemini 3.1+ models. When the Researcher agent encounters external URLs in your notes or prompts, it can now analyse them directly and natively, creating a tighter, more accurate bridge between your personal graph and the outside world. (For local models, you need to provide your own MCP to break the 'local only' processing mode.)

## Zero-Compromise Reliability

An active agent that shapes your vault must be bulletproof. We've deployed crucial reliability improvements to the underpinning architecture:

-   **Agent Write-Access**: Fortified the strict cryptographic boundaries protecting file modifications.
-   **Context Injection**: Improved the stability of the "Accordion" context assembly, ensuring the AI never hallucinates due to context overload.
-   **Streaming Cancellation**: Fixed UI lockups during long-running agent generations.
