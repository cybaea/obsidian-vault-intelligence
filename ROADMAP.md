# 🗺️ Roadmap: Obsidian Vault Intelligence

> **Mission:** To transform your Obsidian vault from passive storage into an active, intelligent partner that connects, verifies, and serves knowledge anywhere.

This document outlines the strategic direction for Vault Intelligence. It is a living document that evolves as we learn from our users and the rapidly changing AI landscape.

---

## 🟢 Phase 1: The Foundation (Completed)

_**Goal**: Removing vendor lock-in and establishing a "Batteries Included" privacy-first experience._

- [x] **Universal "Batteries included" embeddings**
    - **The Vision:** Install the plugin and it _just works_. No API keys required for basic search.
    - **The Tech:** We bundle a lightweight, high-performance model (like `all-MiniLM-L6-v2`) directly into the plugin. It runs 100% locally on your device, ensuring total privacy and zero cost.
    - **Sovereign Intelligence:** "Local-Only" switch that instantly cuts off all cloud API calls.

- [x] **"Sovereign intelligence" (user control & privacy)**
    - **The Vision:** The "Right Model for the Right Task," transparently controlled by you.
    - **The Tech:** Smart routing between fast local models and powerful cloud reasoning.

---

## 🟢 Phase 2: The Agentic Revolution (Completed)

_**Goal**: The AI takes initiative. It stops being a passive chatbot and becomes a proactive worker._

- [x] **"The Researcher" (deep reasoning agent)**
    - **The Vision:** A dedicated agent that can read _long_ documents (200k+ tokens) and perform multi-step reasoning.
    - **Features:** Auto-summarisation, cross-document comparison, and citation tracking using "Greedy Context Packing".

- [x] **"The Computational Solver" (code interpreting)**
    - **The Vision:** The agent can write and execute Python code to analyse your data.
    - **The Use Case:** _"Read my @Expenses note and forecast next month's spend."_
    - **Privacy:** Code runs in a sandboxed WASM environment or via the Gemini Code Execution API.

- [x] **"The Gardener" (vault hygiene agent)**
    - **The Vision:** An agent that proactively tidies your vault.
    - **The Workflow:** Scans recent notes, proposes an interactive plan, and applies changes safely after user review.
    - **The Ontology:** Introduces a formal structure (`Concepts/`, `Entities/`) so the AI knows _where_ things belong.

- [x] **"The Explorer" (semantic navigation)**
    - **The Vision:** A "See Also" sidebar that updates as you type.
    - **The Tech:** High-recall similarity search that finds related notes even if they don't share keywords.

---

## 🟡 Phase 3: Breaking Silos (Current Focus)

_**Goal**: The Agent stops living in the sidebar. It works IN your editor and OUT with other apps._

- [ ] **"The Ghostwriter" (inline co-creation)**
    - **The Vision:** Break the "Chat Sidebar" silo. The agent works directly in your editor, acting as a collaborative writer.
    - **The Features:** Inline Edit, Generative Insertion, and Smart File Creation.

- [ ] **Model Context Protocol (MCP) server**
    - **The Vision:** Use your vault notes inside **Claude Desktop**, **Microsoft Copilot**, or other AI tools.
    - **The Tech:** Implement the [MCP Standard](https://modelcontextprotocol.io/) to turn this plugin into a local server.

- [ ] **Multi-provider reasoning**
    - **The Vision:** Freedom of choice. Use the best model for the job, regardless of who makes it.
    - **The Tech:** Abstraction layer allowing the Research Agent to run on OpenAI, Anthropic, or local open-weights models.

---

## 🟠 Phase 4: Visual Intelligence (The "Excalidraw" Stream)

_**Goal**: Treating diagrams, sketches, and spatial layouts as first-class citizens._

- [ ] **"The Art Critic" (structure extraction)**
    - **The Insight:** Standard search tools cannot see the _relationships_ (arrows, groups, flow) encoded in drawing data.
    - **The Tech:** Parse `compressed-json` blocks to extract explicit connections.

- [ ] **ExcaliBrain graph reasoning**
    - **The Integration:** Deep support for [ExcaliBrain](https://github.com/zsviczian/excalibrain).

- [ ] **"Sketch-to-Structure" (de-rendering)**
    - **The Vision:** Turn a messy whiteboard sketch into a clean note.

- [ ] **"Text-to-Diagram" (generative UI)**
    - **The Vision:** Ask the agent to _draw_ for you.

---

## 🔵 Phase 5: The Agentic Leap (Future Horizons)

_**Goal**: Moving from "Questions" to "Tasks." The agent goes off, does work, and comes back._

- [ ] **Voice interface (desktop first)**
    - **The Vision:** Talk to your vault while you work.

- [ ] **The "Analyst" (multimodal ingestion)**
    - **The Vision:** Drag **images, PDFs, and audio recordings** into the chat.

- [ ] **Autonomous research reports**
    - **The Vision:** Give the agent a job, not a prompt. _"Research the current state of Solid State Batteries."_

---

## Phase 6: Blue sky (experimental)

_**Goal**: Novel interaction paradigms that define the future of PKM._

- [ ] **"Graph Gardener" (maintenance agent)**
    - A background agent that studies your vault's structure while you sleep.

- [ ] **Temporal intelligence ("vault evolution")**
    - Analyse how your opinion on a topic has changed over time.

---

## Technical architecture & challenges

### 1. The "Batteries included" embedding layer

- **Status:** Delivered (Phase 1).
- **Next:** WebGPU transition.

### 2. Editor integration ("Ghostwriter")

- **Constraint:** Concurrency safety.
- **Strategy:** `Editor` transaction API.

### 3. Model Context Protocol (MCP) implementation

- **Constraint:** Local server security.

### 4. Handling Excalidraw hybrid files

- **Strategy:** `LZString` decompression.

---

## Contributing

This roadmap is not set in stone. We welcome community feedback!

- **Have an idea?** Open a [Feature Request](https://github.com/cybaea/obsidian-vault-intelligence/issues).
- **Want to build it?** Look for issues tagged `help wanted` or `good first issue`.

---

# Research horizons (2026)

_Experimental features targeting the new capabilities of Gemini 3, GPT-5, and Llama 4._

## 1. Visual vault indexing (multimodal RAG)

Index every chart, whiteboard photo, and PDF diagram.

## 2. Autonomous verification layers (corrective RAG)

The agent verifies its own retrieval quality before answering.

## 3. "Agent OS" orchestration (knowledge runtimes)

Treat the Vault as a "Knowledge Runtime" with specialized agents.

## 4. Federated RAG (privacy & silos)

Connect to data _outside_ the Obsidian vault without importing it.
