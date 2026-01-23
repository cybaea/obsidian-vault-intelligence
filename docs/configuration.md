# Configuration

Vault Intelligence is designed to be powerful out of the box, but you can customise it to suit different hardware, budgets, and workflows.

## Connection

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Google API key** | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored in plain text in your plugin settings. Required for all Gemini models and Gemini embeddings. |

## Models

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Embedding provider** | `gemini` | **Google Gemini:** Requires API key. Offloads work to Google. <br>**Local (Transformers.js):** Runs on your CPU. Private and offline. |
| **Embedding model** | `gemini-embedding-001` | **Gemini:** `gemini-embedding-001` (latest). <br>**Local Presets:** <br>• **Small (Potion-8M):** 256 dimensions. Extremely fast, ~15MB. <br>• **Balanced (BGE-Small):** 384 dimensions. Good all-rounder, ~30MB. <br>• **Advanced (Nomic-Embed):** 768 dimensions. Best quality, ~130MB. <br>• **Custom:** Allows you to specify any ONNX-compatible HuggingFace ID. |
| **Indexing delay (ms)** | `5000ms` | The debounce delay for user edits. The plugin waits this long after your last keystroke before re-indexing the current note. High values prevent "spamming" your API quota or CPU while typing. |
| **Bulk indexing delay (ms)** | `300ms` | The delay between individual files during bulk operations (like a full vault scan). Keeps the system responsive and respects API rate limits during large updates. |
| **Chat model** | `gemini-3-flash-preview` | The main intelligence engine. <br>• **Flash:** Best for speed and agentic loops (tool use). <br>• **Pro:** Best for deep reasoning or creative writing, but slower. |
| **Context window budget** | `200,000` | The maximum number of tokens (words/characters) the AI can consider at once. <br>• **Scaling:** Automatically scales proportionally when you switch models to maintain your preferred ratio. <br>• **Reset:** Use the **Reset** icon (↺) to restore to the default 20% of model capacity. <br>• **Note:** This budget is strictly capped by the current model's limit (e.g., ~1M for Gemini 3 Flash). |
| **Grounding model** | `gemini-2.5-flash-lite` | The fast, cost-effective model used specifically for web searches and information verification. |
| **Enable code execution** | `On` | Turns on the **Computational Solver**. When enabled, the agent can write and execute Python code to solve math problems or analyse data. |
| **Code model** | `gemini-3-flash-preview` | The specialised model used for generating Python code. |
| **Model list cache duration (days)** | `7` | How many days to keep the local copy of available Gemini models before refreshing. |
| **Refresh model list** | `None` | A manual trigger to force a fresh fetch of available models. |


## Indexing & Search

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Minimum similarity score** | `0.5` | Relevance threshold. Matches below this score are ignored. <br>• **Higher (0.7+):** Strict. <br>• **Lower (0.35):** Loose. |
| **Similar notes limit** | `20` | Max matches in the sidebar. |
| **Vault search results limit** | `25` | Max notes the Agent can retrieve ("read") for any single question. |

## Ontology & Gardener

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Ontology path** | `Ontology` | The folder where your ontology (concepts, entities, MOCs) is stored. |
| **Gardener plans path** | `Gardener/Plans` | The folder where the gardener should save its proposed plans. |
| **Plans retention (days)** | `7` | How many days to keep gardener plans before purging them. |
| **Excluded folders** | `Ontology, Gardener/Plans` | List of folders the gardener should ignore. |
| **Gardener model** | `gemini-3-flash-preview` | The model used specifically for ontology refinement and hygiene (tidy vault). |
| **Gardener context budget (tokens)** | `100,000` | Maximum total tokens estimated for analysis. <br>• **Scaling:** Scales proportionally when you change the model. <br>• **Reset:** Use the **Reset** icon (↺) to restore to the default 10% of model capacity. |
| **Gardener system instruction** | *Default Rules* | The base persona and rules for the Gardener. |


## Advanced

| Setting | Default | Description |
| :--- | :--- | :--- |
| **System instruction** | *Default Persona* | The core personality and rules for the Agent. |
| **Max agent steps** | `5` | Limits how many "thoughts" (loops) the agent can have before giving an answer. Prevents infinite loops. |
| **Local embedding threads** | `1` (Mobile) / `2` (Desktop) | Only relevant for the **Local** provider. Number of CPU threads used for calculations. Higher is faster but uses more memory/battery. |
| **Gemini retries** | `10` | Automatic retries for spotty connections. |

## Developer

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Log level** | `Warn` | Developer console verbosity. Set to `Debug` to see detailed "Chain of Thought". |
| **Debug model list** | `None` | Log the full response from the last Gemini fetch to the console (`Ctrl+Shift+I`). Automatically refreshes if the list is empty. |


---

## Gemini vs Local Models

Choosing the right embedding provider involves balancing privacy, performance, and accuracy.

### Google Gemini (Cloud)

**Ideal for:** Users with reliable internet who want the highest possible retrieval quality.
- **Pros:** State-of-the-art accuracy (`gemini-embedding-001`), zero local CPU/RAM overhead for embeddings, handles large documents gracefully.
- **Cons:** Requires an API key, subject to remote rate limits, notes are processed by Google (though not used for training per their AI Studio terms).

### Transformers.js (Local)

**Ideal for:** Privacy-conscious users, offline use, or those wanting to avoid API rate limits.
- **Pros:** 100% private and offline, no API costs or rate limits, works with any ONNX-compatible model.
- **Cons:** Uses local CPU/RAM (can slow down older devices), slightly lower retrieval quality on the smallest presets.

| Model Preset | Quality | Speed | Local RAM | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 001** | 5/5 | Fast | 0MB | Best for deep research. |
| **Nomic-Embed** | 4/5 | Medium | ~150MB | Best local quality. |
| **BGE-Small** | 3/5 | Fast | ~40MB | For general use. |
| **Potion-8M** | 2/5 | Fastest | ~15MB | Best for mobile/older PCs. |
