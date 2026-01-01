# Obsidian Vault Intelligence

**Obsidian Vault Intelligence** brings state-of-the-art semantic search and research capabilities to your Obsidian vault using Google Gemini.

## Features

### 🧠 Research Chat

A dedicated research sidebar where you can talk to your vault.

- **Full Context**: The agent understands your conversation history.
- **Multimodal**: Powered by Gemini 3 Flash, supporting text and more.
- **Smart RAG**: Automatically searches your vault for relevant notes to answer your questions.
- **File Mentions**: Use `@` to reference specific files in your chat with built-in autocomplete.
- **Command History**: Quickly recall previous messages using the `Up` and `Down` arrow keys.
- **Improved UI**: Full Markdown rendering, selectable text, and code block support.

#### Examples

##### Insights from your vault

You can ask:

- _"What do I know about X?"_ to search your vault for insights.
- _"What do I know about X and is it still factually correct?"_ to search your vault for insights and verify the information using external sources.

Screenshot: Example prompt _"What do I know about Knight Capital and is my information factually correct?"_ with output showing detailed validation and a summary, as an example of how the plugin can be used:

![Screenshot: Example prompt _"What do I know about Knight Capital and is my information factually correct?"_ with output showing detailed validation and a summary, as an example of how the plugin can be used.](images/knowledge-and-verification.webp)

##### Conversations about specific files

You can limit to specific files by using `@` to reference documents from your vault with built-in autocomplete. For example:

- _"Summarise @bard in three bullet points."_
- _"What are the key differences between @bard and @bard-college-of-lore ? Keep it to three bullet points."_
- _"Briefly summarise all @classes"_ where `classes` is a folder in your vault.

Screenshot: Prompts of _"summarise @bard in three bullet points"_ and _"what are the key differences between @bard and @bard-college-of-lore ? Keep it to three bullet points"_ with output:

![Screenshot: Prompts of _"summarise @bard in three bullet points"_ and _"what are the key differences between @bard and @bard-college-of-lore ? Keep it to three bullet points"_ with output.](images/single-file.webp)

Screenshot: Prompt _"Briefly summarise all @classes"_ with output:

![Screenshot: Prompt _"Briefly summarise all @classes"_ with output.](images/folder-query.webp)

(From the wonderful [DnD 5e SRD in Markdown vault](https://github.com/Obsidian-TTRPG-Community/dnd5e-markdown).)

### 🔍 Hybrid Vault Search

A robust search tool used by the Research Agent to find your information.

- **Semantic Search**: Finds notes based on *meaning*, not just keywords. Uses Gemini embeddings.
- **Keyword Fallback**: Automatically falls back to traditional keyword matching to ensure exact terms (like proper names or specific numbers) are never missed.
- **Automatic Indexing**: Background indexing with rate-limit protection.

### 🖇️ Similar Notes View

Automatically discover connections you didn't know existed.

- Shows a list of notes similar to your currently active file.
- Real-time updates as you switch between documents.
- Confidence scores for every match.

#### Examples

From the DnD 5e SRD in Markdown vault, we can see what is similar to bards:

![Screenshot: Showing the page for the bard class with the similar documents shown in the right sidebar. Apparently, Wizards and Sorcerers are the most similar to Bards.](images/similar-documents-bard.webp)

Note that this is contextual similarity, not just word similarity.

## Getting Started

1. **API Key**: Obtain a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2. **Setup**: Enter your API key in the plugin settings.
3. **Indexing**: The plugin will begin indexing your vault in the background. You can monitor progress in the developer console.

## Configuration

- **Embedding model**: Defaulted to `gemini-embedding-001` for stable performance. See [Gemini API | Embeddings](https://ai.google.dev/gemini-api/docs/embeddings) for available models.
- **Chat model**: Defaulted to `gemini-3-flash-preview` for cutting-edge capabilities. See [Gemini API | Gemini Models](https://ai.google.dev/gemini-api/docs/models) for available models.
- **Vault search results limit**: Control how many results are returned by the hybrid vault search (default `25`). This affects both the Similar Notes view and the Research Chat. More results may improve answer quality but increase latency and cost.
- **Minimum similarity score**: Fine-tune how "related" a note must be to appear in your sidebar (default `0.5`).
- **Indexing delay**: Control the speed of background indexing. Higher values reduce the risk of rate limiting on large vaults.
- **Gemini retries**: Automatically retry failed API calls (useful for handling usage limits).
- **Log level**: Control the verbosity of logs in the developer console (`Debug`, `Info`, `Warn`, `Error`). Level `Info` will show indexing progress.

![Screenshot: Plugin options](images/options.webp)

## Links

- **Main Repository**: [GitHub](https://github.com/cybaea/obsidian-vault-intelligence)
- **Issue Tracker**: [Report a Bug / Request a Feature](https://github.com/cybaea/obsidian-vault-intelligence/issues)

## Installation

### Community Plugins (Upcoming)

Search for "Vault Intelligence" in the Obsidian community plugin browser.

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`).
2. Create a folder `.obsidian/plugins/obsidian-vault-intelligence` in your vault.
3. Copy the files into that folder.
4. Reload Obsidian and enable the plugin.

## Common problems

1. **Indexing fails with "429" (rate limited)** (visible in the developer console, which you can usually open with Ctrl+Shift+I): At the time of writing (December 2025), the servers for the Gemini API are under-provisioned and rate limiting is common, even with a paid account. This is the compute pool for all Gemini API users being exhausted. You will see this in the developer console:

    ```
    POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent 429 (Too Many Requests)
    ```

## License

MIT License

## See also

For users looking for more mature implementations of AI in Obsidian and who are comfortable with paying for it, we recommend checking out [Smart Connections](https://smartconnections.app/smart-connections/) and [Smart Chat](https://smartconnections.app/smart-chat/). Our plugin aims to provide a powerful, lightweight, and open-source (MIT license) alternative, initially focused on the Gemini ecosystem.

