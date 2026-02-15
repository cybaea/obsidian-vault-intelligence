# 7.0.0 — The Foundation Update

This release marks a major pivot in the Vault Intelligence journey. While previous updates focused on expanding what the agent *can* do, version 7.0 is entirely dedicated to ensuring it can do those things **safely** and **reliably** at any scale.

We have rebuilt the core architecture to move from a "plugin" to a "platform". With a new Service-Oriented Architecture (SOA), robust security hardening, and enterprise-grade persistence, this update lays the foundation for the next generation of agentic capabilities.

## The Pillars

### 1. Opt-In Security Control
Your vault's security is paramount. We have introduced strict new boundaries for the agent's network access. By default, the agent is now strictly firewalled from your local network (localhost, 127.0.0.1) and cloud metadata services.

For power users who need the agent to interact with local LLMs (like Ollama) or internal dashboards, we've added an explicit **"Allow Local Network Access"** toggle in the Advanced settings. This gives you complete control over the agent's reach.

### 2. Enterprise-Grade Resilience
We have completely overhauled how the plugin saves data. By isolating critical storage operations and implementing atomic file saves, we have eliminated the "content drifted" and "database locked" issues that could occur during high-load operations.

*   **Atomic Saves**: Metadata updates now use a single, atomic operation to prevent frontmatter corruption during race conditions.
*   **Isolated Storage**: We've separated the volatile "Hot Store" (IndexedDB) from the main thread, ensuring that even if the database is under load, your typing experience remains silky smooth.
*   **Smart Timeouts**: The agent now intelligently manages connection timeouts, allowing large model downloads to take their time while ruthlessly cutting off hung API calls to prevent memory leaks.

### 3. Service-Oriented Architecture
Under the hood, we have refactored the entire plugin into a Service-Oriented Architecture (SOA). This disentangles the complex web of dependencies between the chat, the graph, and the search engine.

For you, this means:
*   **Zero-latency UI**: The interface is decoupled from the heavy lifting, so the plugin feels instant.
*   **Rock-solid stability**: Issues in one part of the system (like a failed download) no longer cascade to crash the whole plugin.
*   **Scalability**: The new architecture handles 10,000+ note vaults with the same ease as a 100-note demo vault.

## Quality of Life Improvements

*   **Explorer Stability**: Fixed a race condition where the "Similar notes" view would sometimes be empty after a reload.
*   **Helpful Empty States**: The Explorer now guides you when no file is active, rather than showing a blank screen.
*   **Path Safety**: We've hardened the tool registry against path traversal attacks, ensuring the agent can strictly only access the files it's supposed to.
*   **Prompt Injection Defense**: We've replaced the markdown renderer in confirmation modals with raw code blocks. This prevents malicious instructions from "hiding" in the confirmation text, ensuring you always see exactly what the agent is planning to do.
