# Vault Intelligence: AI Governance Framework

This document serves as the **Project Constitution**. All AI agents MUST adhere to these Pillars and Standards. Failure to follow these constraints is considered an **Architectural Failure**.

## 1. The Four Pillars of Architecture

Every plan, code change, and research task must be scored against these pillars.

### Pillar 1: Markdown-Centric DNA
Vault Intelligence is a text-based research agent. All data features (Search, Graph, AI) MUST revolve around text/markdown representations. 
- **Pattern**: **The Text-Proxy Pattern**. If a feature handles non-text data (PDF, Image, Audio), it MUST be summarized or transcribed into Markdown first for indexing and UI hydration. 
- **Source**: `devs/ARCHITECTURE_AND_STANDARDS.md`.

### Pillar 2: Mobile-First Stability (RAM & Processing)
Obsidian is a cross-platform app running in a resource-constrained environment (especially on Android/iOS).
- **Pattern**: **The Batch-Throttle Pattern**. Avoid loading large binary files into memory on the main thread. Processing must be single-item or small-batch. Never read more than 1MB of binary data into main-thread memory at once.
- **Pattern**: **Atomic Writes**. Use `app.vault.process()` rather than `read/modify` to prevent data corruption. 
- **Source**: `devs/maintainability.md` and `devs/security-and-robustness.md`.

### Pillar 3: Explicit Privacy (Least Privilege)
User trust is non-negotiable. No user data may leave the local vault without explicit, granular consent.
- **Pattern**: **Per-Folder Whitelisting**. Global toggles (e.g., "Index PDFs: ON") are NOT sufficient for cloud-based processing. Users must explicitly whitelist folders for binary processing.
- **Source**: `devs/security-and-robustness.md`.

### Pillar 4: The Good Neighbor (Electron Renderer)
The UI thread must stay reactive at all times.
- **Pattern**: **Main-Thread Ban**. Offload all CPU-intensive work (WASM execution, heavy JSON parsing, binary manipulation) to Web Workers.
- **Pattern**: **System Network Stack**. Favor `requestUrl` (Obsidian API) over `fetch` to bypass CORS and use the system proxy configuration.
- **Source**: `devs/review_checklist.md`.

## 2. The Excellence Checklist (Product Quality)

The Planner and Reviewer must ensure every change hits this high bar:
- **Completeness**: Does it solve all requirements without leaving "TODOs"?
- **UX/UI Excellence**: Is the interface intuitive, premium, and better than competitors?
- **Minimality**: Is it the simplest possible solution? Does it avoid technical debt?
- **Opportunity Analysis**: Does it leverage existing services (e.g., `ResultHydrator`) rather than reinventing?
- **Testing Coverage**: Are there unit tests for edge cases, rate limiting, and failure modes?
- **Red-Team Analysis**: What happens if the LLM hallucinates, the network fails, or the user has a 1GB PDF?

## 3. Hard Constraints (The Law)

- **No Magic Numbers**: All specific values (thresholds, timeouts, caps) MUST reside in `src/constants.ts`.
- **No `child_process.exec()`**: Use `spawn` with argument arrays to prevent command injection.
- **No Direct `fs`**: Never use Node.js `fs` module at the top level. Use `app.vault` or `adapter`.
- **Validation**: All external data (API responses, LLM output) must be validated via Zod or similar schema-first tools.
