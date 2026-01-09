# Obsidian Vault Intelligence

![](images/vault-intelligence-social.webp)

**Transform your Obsidian vault from static storage into an active, intelligent partner.**

Vault Intelligence integrates state-of-the-art Gemini 3 models to help you reason across your entire knowledge base, uncover hidden connections, and verify your private notes against the real world.

**Ever wanted to ask, *"What do I know about X?"* instead of hunting for keywords?**

Now you can. The Agent understands what you *mean*, not just what you type.

Examples:

- **[Knowledge retrieval](docs/examples.md#knowledge-retrieval)**: _What do I know about Knight Capital?_ (Personal vault).
- **[Knowledge verification](docs/examples.md#knowledge-verification)**: _What do I know about RAG and is my information comprehensive, factually correct, and up to date?_ (Personal vault and Google Search).
- **[Computational solver](docs/examples.md#computational-solver)**: _Read @"Monthly Expenses" . Group the data by month to find the total Q4 spend and forecast my January total based on the trend._ (Personal vault with Python code execution). You can even plot the data.
- **[Document context](docs/examples.md#document-context)**: _Briefly summarise @bard._ (Single document; D&D 5e vault).
- **[Multiple documents](docs/examples.md#multiple-documents)**: _Briefly compare @bard with @bard-college-of-lore _. (Multiple documents; D&D 5e vault).
- **[Folder context](docs/examples.md#folder-context)**: _Briefly summarise all @classes _. (Multiple documents in a folder; D&D 5e vault).
- **[Similar documents](docs/examples.md#similar-documents)**: Shows related notes for the current document in a sidebar (D&D 5e vault).


---

## 🔮 The Vision

We believe knowledge management should be active, not passive. Your vault shouldn't just store ideas—it should help you develop them.

See our **[Roadmap](ROADMAP.md)** to explore our journey toward autonomous research, multimodal analysis, and agentic workflows.

---

## Why Vault Intelligence?

Managing a growing vault is hard. Notes get lost, facts get outdated, and connections are missed. Vault Intelligence solves this by enabling you to:

-   **Chat with your notes:** Ask complex questions like *"How has my thinking on Project Alpha evolved?"* to synthesize insights across hundreds of files.
-   **Verify facts:** Instantly cross-reference your private notes with live Google Search results to check accuracy.
-   **Analyze your data:** Use the integrated **Computational Solver** to extract tables or logs from your notes and run real Python analysis (forecasting, trends, statistics) directly in the chat.
-   **Connect the dots:** Automatically discover related notes you wrote months ago, surfacing insights you might have forgotten.

## Key Features

### 🤖 Research Agent

A dedicated sidebar for collaborating with your vault.

-   **Deep Context:** Uses a "Greedy Packing" engine to read **full documents** (up to 200k tokens), understanding the nuance of long reports rather than just snippets.
-   **Computational Solver:** A specialized sub-agent that writes and executes Python code. Perfect for analysing personal data, such as *"Read my @Expenses note and forecast next month's spend based on the Q4 trend"* or *"Plot my weight loss progress from my @Journal entries."*
-   **Live Grounding:** Verifies claims against real-time Google Search data.
-   **Smart Context:** Use `@` to mention specific files (e.g., `@meeting-notes`) or folders to focus the AI's attention.

<details>
<summary>📸 <strong>Click to see the Research Agent in action</strong></summary>

Prompt: _What do I know about RAG and is my information comprehensive, factually correct, and up to date?_

<img src="images/knowledge-and-verification.webp" alt="Research Agent verification example" width="100%">

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
<summary>📸 <strong>Click to see the Similar Notes Sidebar</strong></summary>

<img src="images/similar-documents-bard.webp" alt="Similar Notes Sidebar example" width="100%">

</details>

---

## 🌐 Network Use

To provide intelligent reasoning and search capabilities, this plugin uses external network services. In compliance with [Obsidian developer policies](https://docs.obsidian.md/Developer+policies), here is a clear explanation of how and why network access is used:

- **Google Gemini API** (`https://generativelanguage.googleapis.com`): Processes your notes for chat, reasoning, and semantic search. It also powers the **Google Search Grounding** and **Computational Solver** (Python execution) features.
- **Hugging Face** (`https://huggingface.co`): Used to download open-source embedding models (e.g., Nomic, BERT) for **local processing** when you prefer not to send note content to an external API for indexing.
- **jsDelivr** (`https://cdn.jsdelivr.net`): Downloads the WebAssembly (WASM) runtimes required to execute the embedding models locally within Obsidian.
- **User-Initiated Web Access**: Use of the **URL Reader** tool (via the Research Agent) will trigger a request to the specific URL you provide to retrieve its content for the AI to analyze.

> [!NOTE]
> All note content used for indexing or chat is only sent to the service provider (Google) if you use the cloud-based Gemini models. Local models downloaded from Hugging Face run entirely on your device.

---

## Getting Started

1.  **Get an API Key:** Obtain a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2.  **Install:** Search for "Vault Intelligence" in Community Plugins (or use [BRAT](https://github.com/TfTHacker/obsidian42-brat) with this repo URL).
3.  **Configure:** Enter your API key in **Settings > Vault Intelligence**.
4.  **Restart:** Restart Obsidian to begin background indexing.

## Configuration & Documentation

The plugin is designed to work out-of-the-box, but is highly customizable.

* **[Configuration Guide](docs/configuration.md)**: Detailed explanation of every setting (Models, Context Window, Embeddings).
* **[Example Prompts](docs/examples.md)**: A "Cookbook" for advanced reasoning, data analysis, and fact-checking.
* **[Troubleshooting](docs/troubleshooting.md)**: Fixes for "429 Too Many Requests" and other common issues.

<details>
<summary>🛠️ <strong>Click to see the Settings Panel</strong></summary>

<img src="images/options.webp" alt="Settings Panel" width="100%">

</details>

---

## Contributing
We welcome contributions!
-   **Users:** Report issues on [GitHub Issues](https://github.com/cybaea/obsidian-vault-intelligence/issues).
-   **Developers:** Read [CONTRIBUTING.md](CONTRIBUTING.md) and check the [Roadmap](ROADMAP.md) for "Good First Issues."

**License:** MIT
