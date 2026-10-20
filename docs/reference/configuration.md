---
description: Reference for every Vault Intelligence settings tab, in the order they appear in the plugin's settings window.
keywords: configuration, settings, connection, researcher, explorer, gardener, storage, shards, purge, re-index, mcp, advanced, api key, voyage, anthropic, ollama
---

# Configuration

Vault Intelligence is designed to be powerful out of the box, but you can customise it to suit different hardware, budgets, and workflows.

This reference mirrors the plugin's settings window: one section per tab, in tab order (Connection, Researcher, Explorer, Gardener, Storage, MCP Tools, Advanced), with one entry per setting under the same group headings shown in the app. Rows marked "shown when …" only appear in the settings window under that condition.

## Connection

Manage your core intelligence providers and credentials. Credentials are stored in your device's OS keychain (or masked in `data.json` if secure storage is unavailable) and are never synced.

### Connection settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| Documentation | — | Link row that opens the documentation for the current settings tab. |
| Secure storage status | — | Shows whether API keys live in the OS keychain or in the masked plain-text fallback (`data.json`). On systems without keychain support it also offers a "Retry secure storage" button: reload Obsidian, then click it to re-attempt the keychain migration. |

### Google Gemini API provider

| Setting | Default | Description |
| :--- | :--- | :--- |
| Google API key | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored securely in your system keychain (or masked in `data.json` if secure storage is unavailable). Required for all Gemini models and embeddings. Required by default for the Researcher, Gardener, web search, and the Solver. |

### Other model providers

| Setting | Default | Description |
| :--- | :--- | :--- |
| Connection preset | `None` | Quick-fill presets for common providers: Ollama (local), Ollama Cloud, the Kilo Gateway, and Anthropic. Fills in the endpoint and a secure, keychain-backed API key header where the provider needs one, then refreshes the model list. |
| Ollama endpoint | `http://localhost:11434` | Server URL for your Ollama connection: a local instance or Ollama Cloud (`https://ollama.com`). Required for Ollama-based chat and embeddings. |
| Ollama Cloud API key | `None` | Sent as the `Authorization: Bearer` header for Ollama Cloud requests and wired to that header automatically. Uses the native device keychain control: click it to link or add the credential, click Change to replace it, and the stored state shows as masked dots. Never synced. Shown only when the Ollama endpoint points at Ollama Cloud. |
| Ollama headers | `None` | Custom HTTP headers for Ollama API requests, for example an `Authorization: Bearer` key. Values marked as Secret are stored in the device keychain. |
| OpenAI-compatible endpoint | `None` | Base URL of an OpenAI Chat Completions API, such as the Kilo Gateway (`https://ai-gateway.kilo.ai/api/v1`), LM Studio, llama.cpp, vLLM, or OpenRouter. Local servers are matched with `http://` automatically when you type the address without a scheme. See the [OpenAI-compatible endpoints guide](/docs/how-to/openai-compatible-endpoints). |
| Kilo API key | `None` | Sent as the `Authorization: Bearer` header for Kilo Gateway requests and wired to that header automatically. Uses the native device keychain control: click it to link or add the credential, click Change to replace it, and the stored state shows as masked dots. Never synced. Shown only when the OpenAI-compatible endpoint points at the Kilo Gateway. |
| Anthropic API key | `None` | Sent as the bearer header with every request to Anthropic (via its OpenAI SDK compatibility endpoint) and stored in your device keychain; never synced. Shown only when the OpenAI-compatible endpoint points at Anthropic. Shares its keychain credential with the Kilo Gateway preset, so the same key survives switching between the two. |
| OpenAI-compatible headers | `None` | Custom HTTP headers for OpenAI-compatible API requests, for example an `Authorization: Bearer` key. Values marked as Secret are stored in the device keychain. |
| Voyage AI API key | `None` | Secure credential for connecting to Voyage AI, the cloud embeddings option. Stored in the device keychain (or masked in `data.json` if secure storage is unavailable). Never synced. |

### Model management

| Setting | Default | Description |
| :--- | :--- | :--- |
| Refresh model list | `None` | A manual trigger to fetch available models from the Gemini API, your Ollama server, and any OpenAI-compatible endpoint. |

---

## Researcher

Customise your primary research assistant's intelligence and writing style.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Chat model | `gemini-flash-latest` | The main engine used for reasoning and answering questions. <br>• _Cloud (Gemini):_ High quality, zero local overhead. <br>• _Ollama:_ Fully private or free to run (local or Ollama Cloud). <br>• _OpenAI-compatible:_ Any OpenAI Chat Completions server (Kilo Gateway, LM Studio, vLLM, OpenRouter, the OpenAI API, and Anthropic's compatibility layer). |
| Custom chat model | — | Shown when Chat model is set to `Custom`: enter the model identifier exactly as the server names it. |
| Language | `English (US)` | The primary language for agent responses. This affects the default system prompt and output style. Pick `Other` to enter an arbitrary language via the Custom language code row. |
| Custom language code | — | Shown when Language is set to `Other`: enter the language name or code. |
| System instruction | `Default (Managed)` | The core personality and rules for the Researcher. Leave as default to receive automatic improvements in future updates. |
| Context window budget (tokens) | `200,000` tokens | The maximum volume of notes the AI can "read" at once. Higher budgets allow for broader research but may hit API limits. The description shows the limit in effect for the selected model. <br><br>> [!TIP]<br>> If you experience "429 Too Many Requests" errors, try lowering this budget. See the [Troubleshooting Guide](troubleshooting.md#429-too-many-requests) for details. |
| Max agent steps | `5` | Limits the number of "reasoning loops" the agent can take to prevent infinite thinking or excessive API costs. |

### Context configuration

| Setting | Default | Description |
| :--- | :--- | :--- |
| Author name | `Me` | The name used when the agent refers to you or credits content. This also acts as a fallback for missing author metadata in your notes. |
| Context aware headers | `title, topic, tags, date, author, status` | Comma-separated list of frontmatter properties the AI should always be aware of when analyzing a note chunk. |

### Capabilities

| Setting | Default | Description |
| :--- | :--- | :--- |
| Enable web search | `On` | Allows the agent to verify facts and fetch live news from the internet. |
| Enable link context | `On` | Allows Gemini models to natively analyse URLs using Google's internal retrieval system for higher accuracy. |
| Web search model | `gemini-flash-lite-latest` | A cost-effective model specialised for verifying information and searching the web. Shown when Enable web search is on. |
| Custom web search model | — | Shown when Web search model is set to `Custom`: enter the model identifier. |
| Enable computational solver | `On` | Allows the agent to write and execute Python code for complex math and data analysis. |
| Enable agent write access | `Off` | Allows the agent to create or update notes. **Security Note:** This always requires manual confirmation before any file is changed. |
| Code execution model | `gemini-flash-latest` | The specialized model used for generating Python code. Shown when Enable computational solver is on. |
| Custom code model | — | Shown when Code execution model is set to `Custom`: enter the model identifier. |
| Vault reading limit | `25` | Maximum number of notes the researcher can retrieve to answer a single question. |

---

## Explorer

Fine-tune how connections are discovered and how the semantic graph is visualised.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Embedding provider | `gemini` | Choose where your document vectors are calculated. Changing this triggers a full vault re-embedding on exit. <br>**Google Gemini:** Cloud-based (requires an API key). <br>**Ollama:** Local or cloud server (requires an Ollama connection). <br>**OpenAI-compatible:** Any server offering `/embeddings` (LM Studio, vLLM, OpenAI; the Kilo Gateway does not). <br>**Voyage AI:** Cloud-based (requires a Voyage API key). <br>**Transformers.js:** 100% local CPU/GPU processing (no server required). |
| Embedding model | `gemini-embedding-001` | The specific model used to generate vector embeddings. Local models (eg `nomic-embed-text`) are downloaded once (~25MB--150MB). Shown for online (cloud/server) providers. |
| Custom embedding model | — | Shown when Embedding model is set to `Custom`: enter the model identifier exactly as the server names it. |
| Embedding dimension | `768` | Control the size of the vector. Higher dimensions mean better search but a larger index. Changing this triggers a full vault re-embedding on exit. Local models (like the Transformers.js models) support lower Matryoshka dimensions. |
| Local embedding model | `local/Xenova/multilingual-e5-small` (registry default) | The specific model used to generate vector embeddings while the local (Transformers.js) provider is active. There is no separate local-model setting: the choice is stored on the shared `embeddingModel` key while the local provider is active. Downloaded once when first used. |
| Custom local model | — | Shown when the local model dropdown is set to `Custom`: enter an arbitrary Transformers.js model identifier. |
| Model dimensions | `—` | The output vector size. Incorrect values break search. Override used when a custom or unlisted local model has no built-in dimension metadata. |
| Local model status | `—` | Manage the local weights for the active Transformers.js model; includes a Force re-download button (which shows "Downloading..." while fetching). |
| Quantize local model | `On` | Enable 8-bit quantization to reduce memory usage and download size. Disable to run the unquantized fp32 model fully on the GPU (where WebGPU is available). |

#### Note for flatpak users

The local Transformers.js engine uses WebGPU when available. If you want to take full advantage of your GPU, and

1.  you have installed Obsidian using flatpak (which usually means you are on Linux), and
2.  you are using Transformers.js,

then you need to start Obsidian with the flags:

```bash
flatpak run md.obsidian.Obsidian --enable-unsafe-webgpu --enable-features=Vulkan
```

You can make this permanent by running this once:

```bash
# Ensure the configuration directory exists
mkdir -p ~/.var/app/md.obsidian.Obsidian/config/obsidian/

# Append your flags to the user-flags file
echo "--enable-unsafe-webgpu" >> ~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf
echo "--enable-features=Vulkan" >> ~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf
```

### Search

| Setting | Default | Description |
| :--- | :--- | :--- |
| Enable dual-loop search | `On` | Combines fast local vector search (Loop 1) with deep AI re-ranking (Loop 2). This significantly reduces "hallucinations" in search results. |
| Re-ranking model | `gemini-flash-latest` | The AI engine used by the "Analyst" (Loop 2) to verify and rank the most relevant notes. Shown when dual-loop search is on. |
| Custom re-ranking model | — | Shown when Re-ranking model is set to `Custom`: enter the model identifier exactly as the server names it. |
| Minimum similarity score | `0.5` | Relevance threshold (0.0 to 1.0). Lower this if search results feel too sparse. |
| Similar notes limit | `20` | Max results displayed in the sidebar when looking for related content. |
| Semantic graph node limit | `250` | Maximum number of nodes rendered in the Galaxy view and search expansion. |
| Structural edge thickness | `1.0` | Visual weight of your explicit `[[wikilinks]]`. |
| Semantic edge thickness | `0.5` | Visual weight of implied relationships discovered by AI. |
| Keyword match weight | `1.2` | Calibration for keyword vs vector search. Higher values make keyword matches more conservative in hybrid results. |
| Implicit folder semantics | `ontology` | Controls how your folder structure is weighted. <br>• _none_: Folders are ignored. <br>• _ontology_: Folders act as topics only if they match your fixed Ontology. <br>• _all_: Every folder is treated as a semantic topic. |

> [!TIP]
> If your search results are missing known information, consult the [Search Quality](troubleshooting.md#the-agent-says-it-cant-find-information-but-i-know-i-have-a-note-on-it) section of the troubleshooting guide.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Re-index vault | — | Wipe and rebuild all embeddings for the entire vault. Required after changing models. The button asks for a second click to confirm. |

---

## Gardener

Configure the automated hygiene agent to maintain your vault's ontology.

| Setting | Default | Description |
| :--- | :--- | :--- |
| Gardener model | `gemini-flash-latest` | The model used for structural analysis and improvement suggestions. |
| Custom gardener model | — | Shown when Gardener model is set to `Custom`: enter the model identifier. |
| Context budget (tokens) | `100,000` tokens | Max tokens allowed for a single analysis. The description shows the limit in effect for the selected Gardener model; the reset button on the row returns to the provider default. |
| Gardener rules | `Default (Managed)` | The persona and rules for the Gardener. Leave as default to receive automatic updates. |

### Paths and retention

| Setting | Default | Description |
| :--- | :--- | :--- |
| Ontology path | `Ontology` | Folder where concept, entity, and MOC (Map of Content) notes are stored. |
| Gardener plans path | `Gardener/Plans` | Folder where proposed hygiene plans are saved for your review. |
| Plans retention (days) | `7` | Duration to keep old plan files before they are automatically purged. |

### Orphan management

| Setting | Default | Description |
| :--- | :--- | :--- |
| Archive folder path | `Ontology/_Archive` | Where pruned or "deleted" notes are moved by the Gardener for safekeeping. |
| Orphan grace period (days) | `7` | Number of days a note must be unlinked/orphaned before the Gardener suggests pruning it. |

### Exclusions

| Setting | Default | Description |
| :--- | :--- | :--- |
| Excluded folders | `Ontology`, `Gardener/Plans` | Folders the Gardener ignores when proposing hygiene actions. The list shows one removable row per folder; "Add excluded folder" appends a new path. |

### Analysis tuning

| Setting | Default | Description |
| :--- | :--- | :--- |
| Recent note limit | `50` | Max number of recent notes to scan for improvements. |
| Re-check cooldown (days) | `1` | Wait duration before re-examining unchanged files. |
| Skip retention (days) | `7` | How long to remember skipped files. |
| Semantic merge threshold | `0.85` | Similarity score required to merge two isolated topics (from 0.5 to 1.0). Set to 1.0 to disable semantic merging. |

---

## Storage

Manage local vector databases and sharded storage. Vault Intelligence stores its search index and relationship graph in a specialised binary format: MessagePack shards of the form `graph-state-<model-id>.msgpack` in the vault's hidden `.vault-intelligence/` folder.

- **Shard separation**: The plugin stores separate indexes for different embedding models to prevent data corruption, so you can switch between providers and dimensions without losing data or risking corruption.
- **Automated .gitignore**: The plugin automatically manages a `.gitignore` file inside `.vault-intelligence/` (ignoring everything except the `.gitignore` itself) to prevent massive index files from bloating your Git repository or causing sync conflicts.
- **Data Safety**: The index is a derived cache; it can be regenerated from your notes at any time by clicking **Re-index vault** in the Explorer tab (see [Explorer](#explorer)).
- **Secure Storage**: On supported systems (macOS, Windows, Linux with `libsecret`), your API keys are stored in the OS keychain, never in plain text.

### Active database shards

The plugin stores separate indexes for different embedding models to prevent data corruption. Below are the shards currently stored in your vault, one per embedding model: the shard for the active embedding model shows an "Active" badge, and each inactive shard has a delete (trash) button — the first click shows a "Click again to confirm" notice, the second deletes the shard. The active shard cannot be deleted. If no shards exist, the list shows "No database shards found."

### Maintenance

| Setting | Default | Description |
| :--- | :--- | :--- |
| Purge all data | `—` | Completely removes all local indexes, cached models, and stored states. Use this if you encounter persistent errors or wish to clean up all plugin data. Click **Purge and reset**, then click the confirmation notice within 10 seconds to confirm; the plugin reloads automatically afterwards. |

---

## MCP Tools

Vault Intelligence can connect to external MCP (Model Context Protocol) servers to give the agents additional tools. The tab lists your configured servers with an "Add server" button; selecting a server opens the editor.

| Field | Default | Description |
| :--- | :--- | :--- |
| Server name | — | Human-readable name used to identify the server in lists and confirmations. |
| Connection type | — | `Stdio (desktop only)`, `SSE (remote)`, or `Streamable HTTP (remote)`. |
| Command | — | Stdio only: the executable to launch for this server. |
| Arguments | — | Stdio only: one argument per line, avoiding command-line string escaping issues. |
| Server URL | — | Remote connection types (SSE and Streamable HTTP): the server endpoint URL. |
| Environment variables | — | Optional environment variables for the server. Use 'Secret' to securely store API keys in the device keychain; never paste raw API keys into these fields, reference secrets with the `vi-secret:` prefix instead. |
| HTTP headers | — | Optional HTTP headers for authentication (remote connection types only). Use 'Secret' to securely store tokens in the device keychain; never paste raw API keys into these fields, reference secrets with the `vi-secret:` prefix instead. |
| Require explicit confirmation | `On` | If on, you will be prompted to confirm every execution of this server's tools. Turn off only for explicitly safe, read-only tools. |

See [Using MCP Servers](using-mcp-servers.md) for the complete walkthrough, security guidance, and how the `vi-secret:` prefix maps keychain secrets into server configs.

---

## Advanced

Technical tuning for performance, provider reliability, and security.

### Performance

| Setting | Default | Description |
| :--- | :--- | :--- |
| Indexing delay (ms) | `5000` | Debounce delay for background indexing while typing: the wait time after typing stops before re-indexing in the background. |
| Indexing throttle (ms) | `100` | Technical delay between files during processing to avoid API rate limiting. |
| Embedding chunk size | `512` | Target size for vector chunks. Higher values provide more context but risk API rejection if the text is dense (code/cjk). Options: `512` (Standard / cjk max), `1024` (High context / code max), `1500` (Gemini safe), `2048` (Gemini english only), `4096` (Voyage safe), `8192` (Voyage maximum). **Note:** Changing this triggers a full vault re-embedding on exit. |
| Token estimation ratio | `4` | Characters per token for budget estimation. Lower if you use CJK languages or dense code (e.g. 2 for Japanese). **Note:** Incorrect values may cause context-window overflow or under-utilisation. |
| Local worker threads | `2` (desktop) / `1` (mobile) | CPU threads used for local (Transformers.js) embeddings. Higher is faster but heavier. |

### Gemini system and API

| Setting | Default | Description |
| :--- | :--- | :--- |
| Gemini API retries | `10` | Number of retries for spotty connections. |
| Model cache duration (days) | `7` | How long to cache available Gemini models locally. |

### Voyage system and API

| Setting | Default | Description |
| :--- | :--- | :--- |
| Voyage API retries | `10` | Number of retries for connections. |

### Search and context tuning

| Setting | Default | Description |
| :--- | :--- | :--- |
| Primary context threshold | `0.9` | Score relative to top match required for full file content inclusion. |
| Supporting context threshold | `0.7` | Score relative to top match required for snippet inclusion. |
| Structural context threshold | `0.2` | Score relative to top match required for header inclusion. Below this, notes are skipped. |
| Search centrality limit | `50` | Max number of "bridge" nodes to pull in from the graph to expand search context. Higher values improve thematic recall but increase token usage. |
| Max context documents | `100` | Safety limit for total number of documents injected into context. |
| Reset tuning | — | Restore all search and context tuning values to their defaults. |

### Developer

| Setting | Default | Description |
| :--- | :--- | :--- |
| Log level | `Warn` | Console verbosity. Set to `Debug` when collecting information for bug reports. |
| Full model list debug | — | Log raw API response for models to console. A one-off debug button for bug reports. |

### Security

| Setting | Default | Description |
| :--- | :--- | :--- |
| Allow local network access (advanced/risky) | `Off` | **Advanced:** Allows the agent to access `localhost` or private network IPs. <br>> [!CAUTION]<br>> Enabling this makes you vulnerable to SSRF (Server-Side Request Forgery) attacks. Only enable if you are running local tools you fully trust. |

### Model filtering

Hide specific models from dropdown menus to reduce clutter. The list shows a toggle per fetched model (the model's display name with its identifier as description); toggling a model off adds it to the hidden list and removes it from every model picker. If no models are available yet, the list shows "No models available".

---

MCP security details also apply when you hand the agents tools through servers; see the [security and privacy](https://github.com/cybaea/obsidian-vault-intelligence/blob/main/devs/security-and-robustness.md) guide for the plugin's threat model.