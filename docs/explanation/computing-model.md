# The Computing Model

Vault Intelligence is built on a modular "Brain and Body" architecture. The "Body" (Search and Graph) always runs locally on your device, ensuring your vault remains fast. The "Brain" (Reasoning), "Senses" (Embeddings), and "Hands" (Gardener) can be configured to use cloud APIs, a dedicated local server, or run entirely within Obsidian itself.

This design gives you total control over the tradeoffs between privacy, capability, hardware cost, and speed.

## The Three Core Components

1.  **Search & Graph (Always Local)**: The actual searching of your notes, vector database operations (using Orama), and graph traversals are always handled entirely within Obsidian on your local machine. 
2.  **Embeddings**: The models that convert your markdown text into mathematical vectors (numbers) for the search engine to use. 
3.  **Reasoning & Gardening**: The large language models (LLMs) that read retrieved contexts, answer your questions, execute tools, and proactively maintain your vault structure. 

---

## 1. Trade-offs: Embedding Models (The Senses)

When Vault Intelligence indexes your vault, it must convert text to vectors. You have three choices for the embedding engine:

### Option A: Google Gemini (Cloud) - _Default & Recommended_

-   **Model**: `gemini-embedding-001`
-   **Pros**: Low cost, extremely high quality semantic matching, multilingual processing, zero local hardware requirements. Soon to feature multi-format support (not just markdown) with `gemini-embeddings-2`.
-   **Cons**: Requires an internet connection to index new notes, sends your note text to Google.
-   **Best for**: Almost everyone. It is the perfect balance of semantic quality and device efficiency, preserving your battery and RAM.

### Option B: Transformers.js (Local, In-App)

-   **How it works**: Runs a tiny neural network directly inside Obsidian using WebAssembly (WASM).
-   **Pros**: Complete privacy, instantaneous (zero network overhead), no extra software needed. Minimal RAM usage.
-   **Cons**: Limited to smaller context windows (e.g., ~400 words per chunk for `bge-small-en-v1.5`), strains laptop batteries.
-   **Best for**: Users who want absolute privacy without configuring an external server.

### Option C: Ollama (Local, External Server)

-   **How it works**: Sends text to the Ollama application running on your computer.
-   **Pros**: Full privacy, supports massive context windows (e.g., `nomic-embed-text` with 8192 tokens), allows for document-scale embedding.
-   **Cons**: Requires Ollama running in the background, consumes dedicated VRAM/RAM, initial setup overhead.
-   **Best for**: Power users who want to embed entire long-form documents at once instead of granular paragraphs.

---

## 2. Tradeoffs: Reasoning & Gardening Models (The Brain & Hands)

Vault Intelligence supports two primary reasoning engines for the active Chat, Solver, and automated Gardener: **Google Gemini** (Cloud) and **Ollama** (Local).

| Feature | Cloud (Gemini) [Default] | Local (Ollama) |
| :--- | :--- | :--- |
| **Privacy** | High. Only specific note excerpts retrieved by local search are sent to the API. Data is not trained on. | Complete. No data ever leaves your machine. Ideal for highly sensitive offline vaults. |
| **Reasoning Power** | Extreme. State-of-the-art synthesis, huge context windows, and multilingual fluency. | Varies. Depends on the model you download (e.g., Llama 3) and your GPU VRAM setup. |
| **Built-in Tools** | Embedded Web Search and Computational Solver execution capabilities directly in the API. | Requires provisioning external MCP servers to get web search and solver execution. |
| **Speed** | Consistently fast. | Variable depending on your hardware. |
| **Hardware Cost** | High-quality reasoning on all devices. | Requires high-end device with a dedicated GPU (ideally 16GB+ VRAM) for acceptable performance. |
| **Running Cost** | Pay-per-use API with free tier. | Low. Only the cost of electricity and hardware upgrades. |
| **Configuration** | Simple: only requires an API key. | Complex: Requires [tuning](../how-to/ollama.html) of parameters for your hardware and potentially MCP server configuration. |
| **Energy Usage** | Minimal battery impact. | Heavy battery drain and heat generation during active use. |

**The Verdict**: We recommend **Gemini** for 95% of users. It provides the best reasoning quality, massive context, embedded tools, and zero setup without requiring an expensive workstation. However, if you have the hardware and strict offline/privacy requirements, **Ollama** offers a brilliant, uncompromising alternative.

Regardless of your choice, Vault Intelligence operates within a rigorous safety model. To understand how we handle credential storage, SSRF prevention, and secure tool execution, see our **[Security and Robustness Standards](../../devs/security-and-robustness.md)**.
