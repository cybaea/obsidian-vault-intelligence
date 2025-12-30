# Obsidian Vault Intelligence

**Obsidian Vault Intelligence** brings state-of-the-art semantic search and research capabilities to your Obsidian vault using Google Gemini.

> [!NOTE]
> For users looking for more mature (if costly) implementations of AI in Obsidian, we highly recommend checking out [Smart Connections](https://smartconnections.app/smart-connections/) and [Smart Chat](https://smartconnections.app/smart-chat/). Our plugin aims to provide a powerful, lightweight alternative focused on the Gemini ecosystem.

## Features

### 🧠 Research Chat

A dedicated research sidebar where you can talk to your vault.

- **Full Context**: The agent understands your conversation history.
- **Multimodal**: Powered by Gemini 1.5 Flash/Pro, supporting text and more.
- **Smart RAG**: Automatically searches your vault for relevant notes to answer your questions.
- **File Mentions**: Use `@` to reference specific files in your chat with built-in autocomplete.
- **Command History**: Quickly recall previous messages using the `Up` and `Down` arrow keys.
- **Improved UI**: Full Markdown rendering, selectable text, and code block support.

### 🔍 Hybrid Vault Search

A robust search tool used by the Research Agent to find your information.

- **Semantic Search**: Finds notes based on *meaning*, not just keywords. Uses Gemini embeddings (`text-embedding-004`).
- **Keyword Fallback**: Automatically falls back to traditional keyword matching to ensure exact terms (like proper names or specific numbers) are never missed.
- **Automatic Indexing**: Background indexing with rate-limit protection.

### 🖇️ Similar Notes View

Automatically discover connections you didn't know existed.

- Shows a list of notes similar to your currently active file.
- Real-time updates as you switch between documents.
- Confidence scores for every match.

## Getting Started

1. **API Key**: Obtain a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2. **Setup**: Enter your API key in the plugin settings.
3. **Indexing**: The plugin will begin indexing your vault in the background. You can monitor progress in the developer console.

## Configuration

- **Embedding Model**: Defaulted to `gemini-embedding-001` for stable performance.
- **Chat Model**: Defaulted to `gemini-3-flash-preview` for cutting-edge capabilities.
- **Minimum Similarity Score**: Fine-tune how "related" a note must be to appear in your sidebar (default `0.5`).
- **Indexing Delay**: Control the speed of background indexing. Higher values reduce the risk of rate limiting on large vaults.
- **Gemini Retries**: Automatically retry failed API calls (useful for handling usage limits).
- **Log Level**: Control the verbosity of logs in the developer console (`Debug`, `Info`, `Warn`, `Error`).

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

