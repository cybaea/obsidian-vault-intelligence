# Configuration Guide

Vault Intelligence is designed to work out-of-the-box, but is highly customizable to suit different hardware, budgets, and workflows.

## 🔑 Connection

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Google API key** | `None` | Your secret key from [Google AI Studio](https://aistudio.google.com/). Stored in plain text in your plugin settings. |

## 🧠 Models & Capabilities

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Chat model** | `gemini-3-flash-preview` | The main intelligence engine. <br>• **Flash:** Best for speed and "Agentic" loops (tool use). <br>• **Pro:** Best for deep reasoning or creative writing, but slower. |
| **Enable code execution** | `Off` | Turns on the **Computational Solver**. When enabled, the agent can write and execute Python code to solve math problems or analyze data. |
| **Code model** | `gemini-3-flash-preview` | The specialized model used for generating Python code. Only visible if code execution is enabled. |
| **Context window budget** | `200,000` | The maximum number of tokens (approx. 4 chars per token) the agent can read at once. <br>• **Lower (e.g., 50k):** Cheaper, faster, less comprehensive. <br>• **Higher (e.g., 1M):** Reads entire books, but slower and risks hitting API rate limits. |

## 🔍 Indexing & Search

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Indexing delay (ms)** | `200ms` | The pause between indexing files. Increase this (e.g., to `1000ms`) if you encounter "429 Too Many Requests" errors during initial setup. |
| **Minimum similarity score** | `0.5` | The threshold for determining relevance. <br>• **Higher (0.7+):** Strict. Only shows very close matches. <br>• **Lower (0.35):** Loose. Good for finding distant connections but may include noise. |
| **Similar notes limit** | `20` | Maximum number of "Similar Notes" to display in the sidebar for the active file. |
| **Vault search results limit** | `25` | Maximum number of notes the Agent can retrieve ("read") to answer your question. |
| **Grounding model** | `gemini-2.5-flash-lite` | A lightweight model specialized in Google Search queries. Keep this cheap/fast. |

## ⚙️ Advanced Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| **System instruction** | *Default Persona* | The core personality and rules for the Agent. Supports `{{DATE}}` placeholder. |
| **Max agent steps** | `5` | Limits how many "thoughts" (loops) the agent can have before giving an answer. Prevents infinite loops. |
| **Gemini retries** | `10` | How many times to retry a failed API call. Useful if you have a spotty internet connection. |
| **Embedding model** | `gemini-embedding-001` | The model used to vectorize your notes. |
| **Embedding dimension** | `768` | Controls the complexity of your vector index. <br>• `768`: Standard. <br>• `3072`: Max detail. <br>⚠️ **Warning:** Changing this will wipe your index and force a full re-build. |
| **Log level** | `Warn` | Controls the verbosity of the developer console (`Ctrl+Shift+I`). Set to `Debug` to see detailed "Chain of Thought" and context packing decisions. |
