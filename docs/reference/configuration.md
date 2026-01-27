---
description: Comprehensive reference for all Vault Intelligence plugin settings.
keywords: configuration, settings, setup, api key, context budget, gardener, researcher
---

# Configuration: Plugin settings

Vault Intelligence is designed to be powerful out of the box, but you can customise it to suit different hardware, budgets, and workflows.

## Connection

| Setting | Default | Description |
| :--- | :--- | :--- |
| Google API key | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored in plain text in your plugin settings. Required for all Gemini models and Gemini embeddings. |
| Refresh models | `None` | A manual trigger to force a fresh fetch of available models from the Gemini API. |

## Researcher

Consolidate settings for the Research Assistant agent.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Chat model | `gemini-3-flash-preview` | The main intelligence engine. <br>• _Flash:_ Best for speed and agentic loops. <br>• _Pro:_ Best for deep reasoning or creative writing. |
| System instruction | *Default Persona* | The core personality, role, and rules for the Researcher. |
| Context window budget | `200,000` | Max tokens the AI can consider at once. Automatically scales proportionally when you switch models. |
| Max agent steps | `5` | Limits reasoning loops to prevent infinite "thinking" or high costs. |
| Web search model | `gemini-2.5-flash-lite` | Model used specifically for web searches and fact-checking. |
| Enable computational solver | `On` | Allows the agent to write and execute Python code for math and data analysis. |
| Code execution model | `gemini-3-flash-preview` | The specialised model used for generating Python code. |
| Vault reading limit | `25` | Max notes the Researcher can retrieve to answer a single question. |

## Explorer

Configure how connections and similar notes are discovered.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Embedding provider | `gemini` | Google Gemini: Cloud-based. Requires API key. <br>Local: Offline. Runs on your CPU. |
| Embedding model | `gemini-embedding-001` | The vector engine. Choose from Gemini presets or various local ONNX models. |
| Minimum similarity score | `0.5` | Relevance threshold (0.0 to 1.0). Matches below this are ignored. |
| Similar notes limit | `20` | Max number of related notes displayed in the sidebar. |
| GARS Similarity weight | `1.0` | Importance of vector similarity in hybrid scoring. |
| GARS Centrality weight | `0.2` | Importance of graph centrality (popularity) in hybrid scoring. |
| GARS Activation weight | `0.4` | Importance of semantic activation (connections) in hybrid scoring. |
| Re-index vault | `None` | Wipe and rebuild all embeddings. Required after changing models. |

## Gardener

Configure the Gardener agent for ontology maintenance and vault hygiene.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Gardener model | `gemini-3-flash-preview` | The model used for analyzing vault structure and recommending improvements. |
| Gardener rules | *Default Rules* | The persona and hygiene instructions for the Gardener. |
| Ontology path | `Ontology` | Folder where concepts, entities, and MOCs are stored. |
| Gardener plans path | `Gardener/Plans` | Folder where proposed plans are saved. |
| Plans retention | `7 days` | How long to keep gardener plans before purging. |
| Excluded folders | *Default* | Folders the gardener should ignore. |
| Recent note limit | `10` | Max notes to scan in a single session. |
| Context budget | `100,000` | Max token usage for a single gardener analysis. |

## Performance and System

Technical tuning for power users.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Indexing delay | `5000ms` | Wait time after typing stops before re-indexing the current note. |
| Bulk scan delay | `300ms` | Delay between files during full vault scans. |
| Local worker threads | `1-2` | CPU threads for local embeddings. Higher is faster but heavier. |
| Local SIMD acceleration | `Auto` | Enables SIMD instructions for local models. Faster but may be unstable on older hardware. |
| Gemini API retries | `10` | Number of retries for spotty connections. |
| Model cache duration | `7 days` | Duration to cache Gemini model list locally. |
| Log level | `Warn` | Developer console verbosity (`Debug` for full CoT). |

---

## Gemini vs Local Models

### Google Gemini (Cloud)
- **Pros:** Highest quality (`gemini-embedding-001`), zero local CPU/RAM overhead, handles large documents.
- **Cons:** Requires API key, internet dependent, remote processing.

### Transformers.js (Local)
- **Pros:** 100% private, offline, no API costs.
- **Cons:** Uses local resources, slightly lower quality on smaller presets.

## Privacy and Git Sync

Vault Intelligence stores its search index and relationship graph in a specialized binary format inside the plugin's `data/` directory.

- **Automated .gitignore**: The plugin automatically creates and maintains a `.gitignore` file inside its internal data folder.
- **Why?**: These index files can be very large (up to 100MB+ for massive vaults) and change frequently. Excluding them from Git prevents repository bloat and sync conflicts while using plugins like **Obsidian Git**.
- **Data safety**: Since the index is a derived cache, it can be regenerated automatically from your notes at any time.
