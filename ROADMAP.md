# 🗺️ Roadmap: Obsidian Vault Intelligence

> **Mission:** To transform your Obsidian vault from passive storage into an active, intelligent partner that connects, verifies, and serves knowledge anywhere.

This document outlines the strategic direction for Vault Intelligence. It is a living document that evolves as we learn from our users and the rapidly changing AI landscape.

---

## 🟢 Phase 1: The Open Foundation (Current Focus)

_**Goal**: Removing vendor lock-in and establishing a "Batteries Included" privacy-first experience._

We believe you shouldn't need a PhD or an expensive API key just to search your own notes, and you should always know exactly what data is leaving your machine.

- [ ] **Universal "Batteries Included" Embeddings**
    - **The Vision:** Install the plugin and it *just works*. No API keys required for basic search.
    - [x] **The Tech:** We will bundle a lightweight, high-performance model (like `all-MiniLM-L6-v2`) directly into the plugin. It runs 100% locally on your device, ensuring total privacy and zero cost.
    - [ ] **Performance:** Upgrade to **Transformers.js v3** to leverage **WebGPU** for hardware-accelerated indexing (5x–10x speedup on compatible GPUs).
    - [ ] **For Power Users:** Support for connecting to local **Ollama** endpoints or other providers (OpenAI, Anthropic, Azure).

- [ ] **The "Active Graph" Visualization**
    - **The Vision:** Move beyond the static "spaghetti" graph. When you view a note, see a focused, living constellation of related ideas.
    - **The Tech:** An interactive sidebar graph that displays the active note at the center, orbiting related notes, and—crucially—drawing lines *between* those related notes to reveal hidden clusters of knowledge.

- [ ] **"Sovereign Intelligence" (User Control & Privacy)**
    - **The Vision:** The "Right Model for the Right Task," transparently controlled by you.
    - **The Tech:**
        * **Smart Routing:** Automatically route simple searches to fast/cheap models (Gemini Flash) and complex reasoning to deep thinkers (Gemini Pro), with a clear UI showing *why* a model was chosen.
        * **Privacy Toggles:** A "Local-Only" switch that instantly cuts off all cloud API calls, forcing the agent to rely solely on on-device embeddings and local LLMs (via Ollama) for sensitive work.
        * **Data Transparency:** A log view showing exactly what text snippets are being sent to the cloud before they go.

---

## 🟡 Phase 2: Breaking Silos (Next Up)

_**Goal**: The Agent stops living in the sidebar. It works IN your editor and OUT with other apps._

A true partner doesn't just chat from the sidelines. It gets its hands dirty in your documents and connects your vault to the rest of your digital life.

- [ ] **"The Ghostwriter" (Inline Co-Creation)**
    - **The Vision:** Break the "Chat Sidebar" silo. The agent works directly in your editor, acting as a collaborative writer.
    - **The Features:**
        * **Inline Edit:** Highlight a paragraph and ask: *"Rewrite this to be more concise"* or *"Check this specific claim against my 'Project Alpha' notes."* The agent edits the text in-place.
        * **Generative Insertion:** Type `+++` (or a command) to trigger the agent to continue writing from your current cursor position, drawing context from the current file.
        * **File Creation:** Ask the agent: *"Create a new note for the 'Beta Launch' meeting."* It generates the file, applies your templates, fills in the agenda based on previous notes, and opens it for you.

- [ ] **Model Context Protocol (MCP) Server**
    - **The Vision:** Use your vault notes inside **Claude Desktop**, **Microsoft Copilot**, or other AI tools.
    - **The Tech:** Implement the [MCP Standard](https://modelcontextprotocol.io/) to turn this plugin into a local server. You can ask Claude: *"Draft an email based on my 'Project Alpha' notes,"* and it will securely query your Obsidian vault to get the facts.

- [ ] **Multi-Provider Reasoning**
    - **The Vision:** Freedom of choice. Use the best model for the job, regardless of who makes it.
    - **The Tech:** An abstraction layer that allows the "Research Agent" to run on OpenAI, Anthropic, or local open-weights models, while preserving our advanced tool-use capabilities.

---

## 🟠 Phase 3: Visual Intelligence (The "Excalidraw" Stream)

_**Goal**: Treating diagrams, sketches, and spatial layouts as first-class citizens._

We recognize that for many users, "drawing on the other side of the note" is as important as writing. We will leverage the "Hybrid" Markdown format to make your diagrams intelligent.

- [ ] **"The Art Critic" (Structure extraction)**
    - **The Insight:** Your hybrid notes contain the text (`## Text Elements`), but standard search tools cannot see the *relationships* (arrows, groups, flow) encoded in the drawing data.
    - **The Tech:** A background process that parses the `compressed-json` block (or SVG), extracting the explicit connections (e.g., "Element A -> points to -> Element B").
    - **The Result:** The Agent understands the *process* you drew, not just the keywords.

- [ ] **ExcaliBrain Graph Reasoning**
    - **The Integration:** Deep support for [ExcaliBrain](https://github.com/zsviczian/excalibrain).
    - **The Feature:** The agent will respect the explicit `parents`, `children`, and `friends` relationships defined in your ExcaliBrain frontmatter.

- [ ] **"Sketch-to-Structure" (De-rendering)**
    - **The Vision:** Turn a messy whiteboard sketch into a clean note.
    - **The Use Case:** Drag a hybrid `.md` file into the chat and ask: *"Convert this visual logic flow into a Markdown checklist."*

- [ ] **"Text-to-Diagram" (Generative UI)**
    - **The Vision:** Ask the agent to *draw* for you.
    - **The Use Case:** *"Read my note on 'The Hero's Journey' and append an Excalidraw diagram visualizing the cycle."* The agent writes the `compressed-json` block directly into your note, instantly rendering a diagram.

---

## 🔵 Phase 4: The Agentic Leap (Future Horizons)

_**Goal**: Moving from "Questions" to "Tasks." The agent goes off, does work, and comes back._

- [ ] **Voice Interface (Desktop First)**
    - **The Vision:** Talk to your vault while you work.
    - **The Use Case:** A hands-free mode where you can ask questions or dictate notes using natural voice interactions (inspired by Readwise Reader). Ideal for accessibility and "thinking out loud." Mobile support to follow.

- [ ] **The "Analyst" (Multimodal Ingestion)**
    - **The Vision:** Don't just chat with text. Drag **images, PDFs, and audio recordings** into the chat.
    - **The Use Case:** Drop a screenshot of a complex architectural diagram, and ask the agent to critique it against your existing design notes.

- [ ] **Autonomous Research Reports**
    - **The Vision:** Give the agent a job, not a prompt.
    - **The Use Case:** *"Research the current state of Solid State Batteries."* The agent searches Google, reads results, cross-references your vault, and **writes a new note** with a synthesized report.

---

## 🟣 Phase 5: Blue Sky (Experimental)

_**Goal**: Novel interaction paradigms that define the future of PKM._

- [ ] **"Graph Gardener" (Maintenance Agent)**
    - A background agent that studies your vault's structure while you sleep, suggesting merges, splits, and bridges between isolated clusters of knowledge.

- [ ] **Temporal Intelligence ("Vault Evolution")**
    - Analyze how your opinion on a topic has changed over time. *"Summarize how my thinking on 'Remote Work' has evolved since 2020."*

---

## 🏗️ Technical Architecture & Challenges

This section serves as a compass for architects and contributors, outlining the engineering hurdles we must clear to achieve the roadmap.

### 1. The "Batteries Included" Embedding Layer

* **Constraint:** Obsidian plugins run in an Electron environment. We cannot easily ship a Python backend.
* **Strategy:** Adopt **ONNX Runtime Web** or **Transformers.js** to run quantized models directly in the plugin's JavaScript runtime.
    * **WebGPU:** Transition to Transformers.js v3 to move inference from the CPU to the GPU, dramatically reducing indexing time for larger vaults.
* **Challenge:** Balancing plugin bundle size (<100MB target) vs. inference quality. We may need to implement a "Download on Demand" flow for model weights.

### 2. Editor Integration ("Ghostwriter")

* **Constraint:** Safely editing the active markdown file while the user is typing (concurrency).
* **Strategy:** Leverage Obsidian's `Editor` transaction API to inject text or apply diffs without breaking the user's undo history.
* **Inspiration:** VS Code's Inline Chat API.

### 3. Model Context Protocol (MCP) Implementation

* **Constraint:** Exposing a local server from within Obsidian requires careful handling of network ports and security.
* **Architecture:** Spin up a local WebSocket/HTTP server on a configurable port (default `3000`) with token-based authentication.

### 4. Handling Excalidraw Hybrid Files

* **Format:** Markdown with `compressed-json` (LZ-String) blocks.
* **Strategy:** Implement `LZString.decompressFromBase64()` to expand the diagram data for the AI, and compress the AI's JSON output for rendering. We extract structure (arrows/relationships) programmatically to augment the semantic search index.

---

## 🤝 Contributing

This roadmap is not set in stone. We welcome community feedback!

* **Have an idea?** Open a [Feature Request](https://github.com/cybaea/obsidian-vault-intelligence/issues).
* **Want to build it?** Look for issues tagged `help wanted` or `good first issue`.

---

# 🔮 Research Horizons (2026)

*Experimental features targeting the new capabilities of Gemini 3, GPT-5, and Llama 4.*

## 1. Visual Vault Indexing (Multimodal RAG)

**Context:** With **Gemini 3's** native multimodal context window and **GPT-5's** visual perception improvements, text-only RAG is now a legacy constraint.

* **Goal:** Index every chart, whiteboard photo, and PDF diagram in the vault.
* **Implementation:**
    * Generate multimodal embeddings (using models like **Nano Banana** or **LumiRAG** architectures) for all image assets.
    * Allow users to query: *"Look at the architecture diagram in the 'Q3 Review' PDF and list the microservices."*
    * Pass retrieved images directly to the Gemini 3 context window for analysis.

## 2. Autonomous Verification Layers (Corrective RAG)

**Context:** 2026 "Agentic Workflow" standards emphasize "Bounded Autonomy" and self-correction rather than blind generation.

* **Goal:** The agent should verify its own retrieval quality before answering.
* **Implementation:**
    * **Confidence Check:** If internal retrieval yields low similarity scores (e.g., outdated notes from 2023), the Agent automatically flags this gap.
    * **Active Grounding:** Trigger a "Deep Research" sub-loop (similar to **Gemini Deep Research Agent**) to fetch up-to-date facts from the web, then synthesize them with the private notes.
    * **User Outcome:** *"Your notes on React are from 2023. I cross-referenced with the web, and the API has changed. Here is the comparison."*

## 3. "Agent OS" Orchestration (Knowledge Runtimes)

**Context:** The industry is shifting from single-turn chats to "Agent Orchestration Platforms" (or Agent OS) where specialized agents handle specific domains.

* **Goal:** Treat the Vault as a "Knowledge Runtime" rather than just a database.
* **Implementation:**
    * **Router Layer:** A lightweight classifier (using **Gemini 3 Flash**) determines the user's intent: *Drafting, Debugging, or Fact-Checking*.
    * **Specialized Prompts:**
        * *Drafting Mode:* Retrieves stylistic matches from your previous essays.
        * *Debugging Mode:* Prioritizes code snippets and StackOverflow-style notes.
    * **Goal State:** Maintain a "Session Goal" (e.g., "Write a newsletter") that persists across multiple messages, reducing the need to re-prompt context.

## 4. Federated RAG (Privacy & Silos)

**Context:** With the rise of "Enterprise Agentic Systems" and governance controls, data often lives in decentralized, encrypted silos.

* **Goal:** Connect to data *outside* the Obsidian vault without importing it.
* **Implementation:**
    * **External Connectors:** Index local folders (e.g., Zotero libraries, local Code Repos, or 'Work' folders) as separate "Data Silos."
    * **Federated Retrieval:** The Agent queries these external indices only when relevant, respecting the privacy boundaries of each source.