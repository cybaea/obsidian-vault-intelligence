# Configuration

Vault Intelligence is designed to be powerful out of the box, but you can customise it to suit different hardware, budgets, and workflows.

## Connection

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Google API key** | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored in plain text in your plugin settings. Required for all Gemini models and Gemini embeddings. |

## Intelligence & Chat

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Chat model** | `gemini-3-flash-preview` | The main intelligence engine. <br>• **Flash:** Best for speed and "Agentic" loops (tool use). <br>• **Pro:** Best for deep reasoning or creative writing, but slower. |
| **Context window budget** | `200,000` | The maximum number of tokens (words/characters) the AI can consider at once. <br>**Note:** This budget is also constrained by the inherent limit of your chosen **Chat model**. For example, while `gemini-3-flash-preview` supports up to 1 million tokens, other models may support much less. Setting this budget higher than the model's capacity will lead to errors. <br>• **Lower (e.g., 50k):** Cheaper, faster, less comprehensive. <br>• **Higher:** Reads more notes, but increases response time and costs. |
| **Enable code execution** | `On` | Turns on the **Computational Solver**. When enabled, the agent can write and execute Python code to solve math problems or analyze data. |
| **Code model** | `gemini-3-flash-preview` | The specialized model used for generating Python code. Only visible if code execution is enabled. |
| **Max agent steps** | `5` | Limits how many "thoughts" (loops) the agent can have before giving an answer. Prevents infinite loops. |

## Vector Search & Embeddings

Choose how your document vectors are calculated and stored.

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Embedding provider** | `gemini` | **Google Gemini:** Requires API key. Offloads work to Google. <br>**Local (Transformers.js):** Runs on your CPU. Private and offline. |
| **Embedding model** | `gemini-embedding-001` | **Gemini:** `gemini-embedding-004` (latest) or `001`. <br>**Local Presets:** <br>• **Small (Potion-8M):** 256 dimensions. Extremely fast, ~15MB. <br>• **Balanced (BGE-Small):** 384 dimensions. Good all-rounder, ~30MB. <br>• **Advanced (Nomic-Embed):** 768 dimensions. Best quality, ~130MB. <br>• **Custom:** Allows you to specify any ONNX-compatible HuggingFace ID. |
| **Custom model ID** | `None` | (Local + Custom only) The HuggingFace repository ID (e.g., `Xenova/all-MiniLM-L6-v2`). Use the **Validate** button to check compatibility and automatically detect dimensions. |
| **Model dimensions** | `768` | (Local + Custom only) The vector size for your custom model. Must be set correctly for search to function. |
| **Model status** | `N/A` | (Local only) Shows the current model being used by the worker and provides a **Force re-download** button to repair corrupted model files. |
| **Re-index vault** | `N/A` | Clear all saved vectors and re-scan the vault. **Required** whenever you change your embedding model or provider to ensure your index remains compatible. |
| **Embedding dimension** | `768` | Must match your chosen model. <br>**Warning:** Changing this wipes your index. |
| **Minimum similarity score** | `0.5` | Relevance threshold. Matches below this score are ignored. <br>• **Higher (0.7+):** Strict. <br>• **Lower (0.35):** Loose. |
| **Similar notes limit** | `20` | Max matches in the sidebar. |
| **Vault search results limit** | `25` | Max notes the Agent can retrieve ("read") for any single question. |

## Advanced & Hardware

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Local embedding threads** | `1` (Mobile) / `2` (Desktop) | Only relevant for the **Local** provider. Number of CPU threads used for calculations. Higher is faster but uses more memory/battery. |
| **Indexing delay (ms)** | `5000ms` | The debounce delay for user edits. The plugin waits this long after your last keystroke before re-indexing the current note. High values prevent "spamming" your API quota or CPU while typing. |
| **Bulk indexing delay (ms)** | `300ms` | The delay between individual files during bulk operations (like a full vault scan). Keeps the system responsive and respects API rate limits during large updates. |
| **Gemini retries** | `10` | Automatic retries for spotty connections. |
| **System instruction** | *Default Persona* | The core personality and rules for the Agent. |
| **Log level** | `Warn` | Developer console verbosity. Set to `Debug` to see detailed "Chain of Thought". |

---

## Gemini vs Local Models

Choosing the right embedding provider involves balancing privacy, performance, and accuracy.

### Google Gemini (Cloud)

**Ideal for:** Users with reliable internet who want the highest possible retrieval quality.
- **Pros:** State-of-the-art accuracy (`gemini-embedding-004`), zero local CPU/RAM overhead for embeddings, handles large documents gracefully.
- **Cons:** Requires an API key, subject to remote rate limits, notes are processed by Google (though not used for training per their AI Studio terms).

### Transformers.js (Local)

**Ideal for:** Privacy-conscious users, offline use, or those wanting to avoid API rate limits.
- **Pros:** 100% private and offline, no API costs or rate limits, works with any ONNX-compatible model.
- **Cons:** Uses local CPU/RAM (can slow down older devices), slightly lower retrieval quality on the smallest presets.

| Model Preset | Quality | Speed | Local RAM | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 004** | 5/5 | Fast | 0MB | Best for deep research. |
| **Nomic-Embed** | 4/5 | Medium | ~150MB | Best local quality. |
| **BGE-Small** | 3/5 | Fast | ~40MB | For general use. |
| **Potion-8M** | 2/5 | Fastest | ~15MB | Best for mobile/older PCs. |
