# Obsidian Vault Intelligence

**Transform your Obsidian vault from static storage into an active, intelligent partner.**

Vault Intelligence integrates Google's state-of-the-art **Gemini 3** models to help you reason across your entire knowledge base, uncover hidden connections, and verify your private notes against the real world.

> **Ever wanted to ask, *"What do I know about X?"* instead of hunting for keywords?**
>
> Now you can. The Agent understands what you *mean*, not just what you type.

---

## 🔮 The Vision

We believe knowledge management should be active, not passive. Your vault shouldn't just store ideas—it should help you develop them.

See our **[Roadmap](ROADMAP.md)** to explore our journey toward autonomous research, multimodal analysis, and agentic workflows.

---

## Why Vault Intelligence?

Managing a growing vault is hard. Notes get lost, facts get outdated, and connections are missed. Vault Intelligence solves this by enabling you to:

-   **Chat with your notes:** Ask complex questions like *"How has my thinking on Project Alpha evolved?"* to synthesize insights across hundreds of files.
-   **Verify facts:** Instantly cross-reference your private notes with live Google Search results to check accuracy.
-   **Solve problems:** Use the integrated **Computational Solver** to run Python code for math, data analysis, and logic puzzles directly within your chat.
-   **Connect the dots:** Automatically discover related notes you wrote months ago, surfacing insights you might have forgotten.

## Key Features

### 🤖 Research Agent
A dedicated sidebar for collaborating with your vault.
-   **Deep Context:** Uses a "Greedy Packing" engine to read **full documents** (up to 200k tokens), understanding the nuance of long reports rather than just snippets.
-   **Computational Solver:** Handles math and logic queries (e.g., *"Calculate the 102nd prime number"*) using a specialized code-execution sub-agent.
-   **Live Grounding:** Verifies claims against real-time Google Search data.
-   **Smart Context:** Use `@` to mention specific files (e.g., `@meeting-notes`) or folders to focus the AI's attention.

<details>
<summary>📸 <strong>See the Research Agent in action</strong></summary>

![Research Agent verification example](images/knowledge-and-verification.webp)
</details>

### 🔍 Adaptive Hybrid Search
Finds the right note, even if you use the wrong words.
-   **Semantic Search:** Matches meaning (e.g., "financial ruin" finds "bankruptcy").
-   **Fuzzy Keyword Matching:** Boosts exact phrase matches for precision.
-   **Automatic Indexing:** Your vault is re-indexed in the background as you work.

### 🖇️ Similar Notes View
-   **Active Discovery:** Shows a dynamic list of notes related to your *current* open file.
-   **Confidence Scores:** Clearly indicates how relevant each connection is.

<details>
<summary>📸 <strong>See the Similar Notes Sidebar</strong></summary>

![Similar Notes Sidebar example](images/similar-documents-bard.webp)
</details>

---

## Getting Started

1.  **Get an API Key:** Obtain a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2.  **Install:** Search for "Vault Intelligence" in Community Plugins (or use [BRAT](https://github.com/TfTHacker/obsidian42-brat) with this repo URL).
3.  **Configure:** Enter your API key in **Settings > Vault Intelligence**.
4.  **Restart:** Restart Obsidian to begin background indexing.

## Configuration

### Models & Capabilities
-   **Chat model:** Default: `gemini-3-flash-preview` (Best for speed and agentic reasoning).
-   **Enable code execution:** Toggle the specialized Python sub-agent for math/logic tasks.
-   **Context window budget:** Set your token limit (Default: `200,000`). Lower this if you want to save costs; raise it (up to 1M) for massive context, mindful of API rate limits.

### Grounding & Search
-   **Grounding model:** Default: `gemini-2.5-flash-lite` (Cost-effective Google Search).
-   **Indexing delay:** Adjust background processing speed to prevent rate limits.

<details>
<summary>🛠️ <strong>See the Settings Panel</strong></summary>

![Settings Panel](images/options.webp)
</details>

---

For more details, check our **[Documentation](docs/)** (Coming Soon).

## Contributing
We welcome contributions!
-   **Users:** Report issues on [GitHub Issues](https://github.com/cybaea/obsidian-vault-intelligence/issues).
-   **Developers:** Read [CONTRIBUTING.md](CONTRIBUTING.md) and check the [Roadmap](ROADMAP.md) for "Good First Issues."

**License:** MIT
