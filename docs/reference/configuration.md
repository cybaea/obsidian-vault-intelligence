---
description: Comprehensive reference for all Vault Intelligence plugin settings.
keywords: configuration, settings, setup, api key, context budget, gardener, researcher, dual-loop, re-ranking
---

# Configuration

Vault Intelligence is designed to be powerful out of the box, but you can customise it to suit different hardware, budgets, and workflows.

## Connection

Manage your core intelligence providers and credentials.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Google API key | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored securely in your system keychain (or masked in `data.json` if secure storage is unavailable). Required for all Gemini models and embeddings. |
| Ollama endpoint | `http://localhost:11434` | Server URL for local model providers. Required for Ollama-based chat and embeddings. |
| Refresh model list | `None` | A manual trigger to fetch available models from the Gemini API and local Ollama server. |

---

## Researcher

Customise your primary research assistant’s intelligence and writing style.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Chat model | `gemini-3-flash-preview` | The primary reasoning engine. <br>• _Cloud (Gemini):_ High quality, zero local overhead. <br>• _Local (Ollama):_ Fully private and free to run. |
| Agent language | `English (US)` | The primary language for agent responses. This affects the default system prompt and output style. |
| System instruction | `Default (Managed)` | The core personality and rules for the Researcher. Leave as default to receive automatic improvements in future updates. |
| Context window budget | `200,000` tokens | The maximum volume of notes the AI can "read" at once. Higher budgets allow for broader research but may hit API limits. <br><br>> [!TIP]<br>> If you experience "429 Too Many Requests" errors, try lowering this budget. See the [Troubleshooting Guide](file:///home/allane/Code/GitHub/obsidian-vault-intelligence/docs/reference/troubleshooting.md#429-too-many-requests) for details. |
| Max agent steps | `5` | Limits the number of "reasoning loops" the agent can take to prevent infinite thinking or excessive API costs. |
| Author name | `Me` | The name used when the agent refers to you or credits content. This also acts as a fallback for missing author metadata in your notes. |
| Context-aware headers | `title, tags...` | A list of frontmatter properties the AI should always be aware of when analyzing a note chunk. |
| Enable web search | `On` | Allows the agent to verify facts and fetch live news from the internet. |
| Web search model | `gemini-2.5-flash-lite` | A cost-effective model specialised for verifying information and searching the web. |
| Enable link context | `On` | Allows Gemini 3.1+ models to natively analyse URLs using Google's internal retrieval system for higher accuracy. |
| Enable computational solver | `On` | Allows the agent to write and execute Python code for complex math and data analysis. |
| Code execution model | `gemini-3-flash-preview` | The specialized model used for generating Python code. |
| Enable agent write access | `Off` | Allows the agent to create or update notes. **Security Note:** This always requires manual confirmation before any file is changed. |
| Vault reading limit | `25` | Maximum number of notes the researcher can retrieve to answer a single question. |

---

## Explorer

Fine-tune how connections are discovered and how the semantic graph is visualised.

### Embedding Engine

| Setting | Default | Description |
| :--- | :--- | :--- |
| Embedding provider | `gemini` | **Google Gemini:** Cloud-based (requires API key). <br>**Ollama:** Local server (requires Ollama). <br>**Transformers.js:** 100% local CPU processing (no server required). |
| Embedding model | `gemini-embedding-001` | The vector engine used to calculate relationships. Local models (eg `nomic-embed-text`) are downloaded once (~25MB--150MB). |
| Embedding dimension | `768` | Output vector size. Higher dimensions provide better accuracy but result in a larger search index on disk. |
| Embedding chunk size | `1024` / `512` | Character count per vector segment. Automatically adjusts to `512` for complex scripts (Chinese, Japanese) or local models to improve retrieval quality. |

### Search Strategy

| Setting | Default | Description |
| :--- | :--- | :--- |
| Enable dual-loop search | `On` | Combines fast local vector search (Loop 1) with deep AI re-ranking (Loop 2). This significantly reduces "hallucinations" in search results. |
| Re-ranking model | `gemini-3-flash-preview` | The AI engine used by the "Analyst" (Loop 2) to verify and rank the most relevant notes. |
| Minimum similarity score | `0.5` | Relevance threshold (0.0 to 1.0). Lower this if search results feel too sparse. |
| Keyword match weight | `1.2` | Calibration for keyword vs vector search. Higher values make keyword matches more conservative in hybrid results. |
| Similar notes limit | `20` | Max results displayed in the sidebar when looking for related content. |

> [!TIP]
> If your search results are missing known information, consult the [Search Quality](file:///home/allane/Code/GitHub/obsidian-vault-intelligence/docs/reference/troubleshooting.md#the-agent-says-it-cant-find-information-but-i-know-i-have-a-note-on-it) section of the troubleshooting guide.

### Semantic Galaxy

| Setting | Default | Description |
| :--- | :--- | :--- |
| Semantic graph node limit | `250` | Maximum number of nodes rendered in the Galaxy view and search expansion. |
| Structural edge thickness | `1.0` | Visual weight of your explicit `[[wikilinks]]`. |
| Semantic edge thickness | `0.5` | Visual weight of implied relationships discovered by AI. |
| Implicit folder semantics | `ontology` | Controls how your folder structure is weighted. <br>• _none_: Folders are ignored. <br>• _ontology_: Folders act as topics only if they match your fixed Ontology. <br>• _all_: Every folder is treated as a semantic topic. |

---

## Gardener

Configure the automated hygiene agent to maintain your vault's ontology.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Gardener model | `gemini-3-flash-preview` | The model used for structural analysis and improvement suggestions. |
| Gardener rules | `Default (Managed)` | The persona and rules for the Gardener. Leave as default to receive automatic updates. |
| Ontology path | `Ontology` | Folder where concept, entity, and MOC (Map of Content) notes are stored. |
| Semantic merge threshold | `0.85` | Similarity score required to suggest merging two similar topics. Set to `1.0` to disable merging. |

### Orphan Management

| Setting | Default | Description |
| :--- | :--- | :--- |
| Orphan grace period | `7 days` | Number of days a note must be unlinked/orphaned before the Gardener suggests pruning it. |
| Archive folder path | `Ontology/_Archive` | Where pruned or "deleted" notes are moved by the Gardener for safekeeping. |
| Gardener plans path | `Gardener/Plans` | Folder where proposed hygiene plans are saved for your review. |
| Plans retention | `7 days` | Duration to keep old plan files before they are automatically purged. |

---

## Advanced Systems

Technical tuning for performance and security.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Indexing delay | `5000ms` | Wait time after typing stops before re-indexing in the background. |
| Indexing throttle | `100ms` | Technical delay between files during processing to avoid API rate limiting. |
| Search centrality limit | `50` | Max number of "bridge" nodes pulled from the graph to expand search context. |
| Allow local network access | `Off` | **Advanced:** Allows the agent to access `localhost` or private network IPs. <br>> [!CAUTION]<br>> Enabling this makes you vulnerable to SSRF (Server-Side Request Forgery) attacks. Only enable if you are running local tools you fully trust. |
| Log level | `Warn` | Console verbosity. Set to `Debug` when collecting information for bug reports. |

---

## Privacy and Storage

Vault Intelligence stores its search index and relationship graph in a specialised binary format inside the plugin's `data/` directory.

-   **Automated .gitignore**: The plugin automatically manages a `.gitignore` file for its data folder to prevent massive index files from bloating your Git repository or causing sync conflicts.
-   **Data Safety**: The index is a derived cache; it can be regenerated from your notes at any time by clicking **Re-index Vault** in the Explorer settings.
-   **Secure Storage**: On supported systems (macOS, Windows, Linux with `libsecret`), your API keys are stored in the OS keychain, never in plain text.
