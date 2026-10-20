# Getting started with Vault Intelligence

Turn your Obsidian vault into an active research partner in five minutes: install the plugin, connect a model provider, and ask your first question.

## 1. Install Vault Intelligence

Vault Intelligence is published in the official Obsidian Community plugins directory, at <https://community.obsidian.md/plugins/vault-intelligence>:

1. In Obsidian, go to **Settings > Community plugins**. If community plugins are currently restricted, select **Turn on community plugins** first.
2. Select **Browse**, search for "Vault Intelligence", then select **Install**.
3. Select **Enable** to finish.

The plugin starts building its search index as soon as it is enabled. The index runs entirely on your device and it is a derived cache that can be rebuilt from your notes at any time, so no configuration is needed before the next step.

## 2. Connect a model provider

Vault Intelligence splits its intelligence so you can put each part where you want it:

- **Search and connections** always run locally inside Obsidian, on your device.
- **AI agents** (the Researcher, Gardener, and Solver) and the semantic embeddings that power discovery use a model provider you choose: your own machine, a local server, or the cloud.

The quickest path to the full experience is a free Google Gemini key:

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/).
2. In Obsidian, go to **Settings > Vault Intelligence > Connection**.
3. Paste the key into the **Google API key** field. Obsidian stores it in your device keychain and it is never synced to other devices.

Gemini is the recommended default: nothing else to configure, and it is the only provider with the Researcher's built-in web search and Python code execution. Not sure yet? [The computing model](../explanation/computing-model.md) explains why an API key is recommended and what actually leaves your device: only the short note excerpts the agent retrieves, never your whole vault.

### Other providers

Vault Intelligence is provider-agnostic. The reasoning model (the agents' brain) and the embedding model (how notes become searchable vectors) are configured separately in settings:

- [Ollama](../how-to/ollama.md): fully private reasoning on your own hardware, or hosted Ollama Cloud through the same connection. The guide also covers model choice and hardware tuning.
- [OpenAI-compatible endpoints](../how-to/openai-compatible-endpoints.md): LM Studio, vLLM, OpenRouter, the OpenAI API, Anthropic's compatibility layer, and more.
- **Transformers.js** for embeddings: small models that run entirely inside Obsidian, with no server and no API key — a zero-config path to private, offline semantic search.
- **Voyage AI** for embeddings: high-quality cloud embeddings using a [voyageai.com](https://www.voyageai.com) API key.

> [!WARNING]
> Changing the embedding provider or model triggers a full vault re-embedding the next time Obsidian exits, so settle on your setup early to avoid repeating the initial index.

## 3. Your first chat

Let's see the magic immediately.

1. Click the Vault Intelligence icon <span class="vi-doc-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-brain-circuit"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/></svg></span> in the left ribbon and select **Researcher: chat with vault** from the menu that appears.

    ![The Obsidian sidebar highlighting the Vault Intelligence brain circuit icon](/images/screenshots/obsidian-sidebar-icon.png)

2. Type this exact query (or pick a topic relevant to your notes):

    > "What is the most interesting connection between my notes on [Topic A] and [Topic B]?"

    _(Replace [Topic A]/[Topic B] with real topics from your vault, eg "Gardening" and "Recipes")_

### What just happened?

- It read your notes: The agent found relevant files without you searching for keywords.
- It reasoned: It didn't just copy text; it understood the relationship between the concepts.
- It answered: You got a synthesised answer, cited with links to your source files.

    ![A chat response showing citations as clickable links](/images/screenshots/researcher-citations.png)

## 4. Where to go next

Now that you are connected, try a specific workflow:

- [Chat with specific documents](../how-to/researcher-workflows.md)
- [Explore connections](../how-to/explorer-connections.md)
- [Analyse data with Python](../how-to/solver-analysis.md)
- [Clean up your vault structure](../how-to/gardener-workflows.md)

To deepen your setup:

- [Move reasoning to Ollama, locally or in the cloud](../how-to/ollama.md)
- [Use any OpenAI-compatible endpoint](../how-to/openai-compatible-endpoints.md)
- [Every setting, explained](../reference/configuration.md)
- [Fix common problems](../reference/troubleshooting.md)

> [!TIP]
> If you write in Chinese, Japanese, Korean, Arabic, or another logographic or right-to-left script, check the **Agent language** and **Embedding chunk size** settings (the latter lives in the Explorer settings). The plugin automatically optimises chunking for the higher information density of these scripts, which keeps semantic retrieval sharp.
