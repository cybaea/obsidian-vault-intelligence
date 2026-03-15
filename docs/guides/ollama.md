# Using Ollama with Vault Intelligence (2026 Edition)

Vault Intelligence fully supports local execution using Ollama. This guide covers how to select the right models, tune your settings for your hardware (VRAM), and troubleshoot common issues as of our March 2026 updates.

## 1. Selecting Reasoning Models (Chat & Logic)

The "Chat model" powers the Researcher and Gardener agents. The "Code execution model" powers the Computational Solver.

### Recommended Models (March 2026)

*   **Llama 3.1 / 3.3 (8B)**: The gold standard for general chat, reasoning, and learning. Excellent balance of speed and capability for 8GB+ VRAM GPUs. Use the `q4_K_M` quantization.
*   **DeepSeek R1 (0528) / V3.2-Exp**: Exceptional for mathematical and logical reasoning. Recommended if you are actively using the Computational Solver workflow.
*   **Qwen 3.5 (14B - 32B)**: Top-tier multimodal reasoning and agentic tasks. 

> [!WARNING]
> **Qwen 3.5 "Overthinking" Issue**: Qwen 3.5 models have a dedicated "thinking mode" that can cause excessive internal verbosity. If your Researcher agent takes too long or outputs internal thoughts instead of the final answer:
> 1.  Set a Custom System prompt in the Vault Intelligence settings: _"You are concise. Think for at most 3 steps before responding. Do not output your thinking process."_
> 2.  Lower the model's temperature (e.g., 0.6) in your Ollama Modelfile.
> 3.  Alternatively, force Ollama to disable thinking using a custom Modelfile with `PARAMETER think false` or use the `--hidethinking` CLI flag when pulling.

## 2. Selecting Embedding Models

Embedding models convert your notes into vectors for the Explorer and Semantic Search.

### Recommended Models

*   **`bge-small-en-v1.5`**: The recommended balanced model. Very fast, great retrieval performance, but limited to a 512-token context window (roughly 350-400 words).
*   **`nomic-embed-text`**: A highly capable general-purpose embedding model with a large 8192-token context window. Excellent for embedding full documents.
*   **`nomic-embed-text-v2-moe`**: A powerful Mixture of Experts (MoE) model featuring Matryoshka embeddings.

> [!NOTE]
> **Understanding `nomic-embed-text-v2-moe`**: 
> *   **Storage vs. VRAM**: While this model has 475M parameters total (requiring about 2GB of disk space), it only activates ~305M parameters during inference, saving active VRAM.
> *   **Matryoshka Dimensions**: You can configure Vault Intelligence's "Embedding dimension" setting to `256` or `128` instead of the native `768`. This results in a 3x reduction in vector database storage costs and faster search times, with minimal performance degradation. Ensure you select the matching dimension in the Plugin Settings.

## 3. Tuning Performance (Context & VRAM)

Your GPU VRAM is the hard limit for local AI. If a model exceeds your VRAM, Ollama offloads it to your CPU/RAM, resulting in 3x-10x slower performance.

### Context Window Tuning

The "Context window budget" in Vault Intelligence determines how many notes the agent can read at once. 

*   **The Trap**: Setting this to 200,000 tokens (the Gemini default) will instantly cause an Out-Of-Memory (OOM) crash on almost all consumer hardware when using Ollama.
*   **The Math**: Context length (KV Cache) scales linearly with VRAM. 
*   **Recommendations**:
    *   **8GB VRAM**: Use an 8B model (`q4_K_M`). Set the context window budget to **4,096** or **8,192** tokens.
    *   **12GB VRAM**: Use a 12B-14B model (`q4_K_M`), or an 8B model with a **16,384** token context window.
    *   **16GB+ VRAM**: You can push Llama 3.1 to a **32,768** context window.

### Advanced Ollama Optimizations

If you are running Ollama v0.12+ (released late 2025), ensure these environment variables are active on your system:

1.  **`OLLAMA_FLASH_ATTENTION=1`**: Essential for context windows over 4K. Reduces VRAM usage and speeds up processing on modern NVIDIA/AMD cards.
2.  **`OLLAMA_KV_CACHE_TYPE=q4_0`**: Quantizes the context window memory. This allows you to double your Context Budget in Vault Intelligence without buying a new GPU.

### Embedding Chunk Size

The "Embedding chunk size" setting (found in Advanced Settings) controls how large each piece of text is before being vectorized.

*   **Granular (256 - 1024)**: The default. Excellent for precise semantic matching and finding specific paragraphs. Ideal for models like `bge-small-en-v1.5` which have hard context limits.
*   **Document Scale (4096 - 8192)**: Useful for finding broad themes across entire documents and speeding up vault indexing. **Only use this** if your selected embedding model explicitly supports massive context windows (e.g., `nomic-embed-text`).
*   **The Risk**: If you set the chunk size larger than your model's maximum context window, Ollama will silently truncate the text, leading to missing information and poor search quality.

## 4. Debugging & Common Issues

*   **Plugin cannot connect to Ollama**: Ensure Ollama is running and your `Ollama endpoint` in Vault Intelligence is correct (default: `http://localhost:11434`). If Obsidian and Ollama are on different machines, you must set `OLLAMA_HOST=0.0.0.0` on the Ollama server.
*   **Agent never finishes thinking**: 
    1.  Check your terminal running Ollama. Is it printing tokens very slowly? You are likely offloading to CPU. Choose a smaller model quantization (e.g., `q4_` instead of `q8_`).
    2.  Did you select Qwen 3.5? Check the Overthinking section above.
*   **Out of Memory (OOM) Errors**: Lower your "Context window budget" in Vault Intelligence. If that fails, restart Ollama to clear the VRAM cache, and ensure no other heavy applications (video editors, games) are open.
