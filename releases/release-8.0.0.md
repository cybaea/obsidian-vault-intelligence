# 8.0 — The Interactive & Secure Update

This release focuses on two key areas: making it much easier to explore the connections in your vault, and keeping your credentials secure. We are moving from static lists to a visual, interactive graph for your notes. Separately, we are locking down your API keys using your operating system's native keychain to ensure they are never stored in plain text.

> [!WARNING]
> **Breaking Change**: The minimum required version of Obsidian is now **v1.11.4** to support the new native `SecretStorage` API. Because API keys are now stored in your local OS keychain, they will no longer sync across devices. You will need to enter your API key once on each device.

## Semantic Galaxy View

You can now visualise your vault's relationships in a high-performance, interactive graph view that centers on your active note. 

* **Visual RAG**: When the Researcher agent mentions files in its response, those notes are automatically highlighted in the galaxy, providing instant spatial context for the agent's reasoning.
* **Structural & Semantic Discovery**: The view blends structural links with semantic vector similarities, letting you discover both explicit and hidden connections.
* **Interactive Layout Controls**: A real-time "Attraction" slider lets you cluster related concepts, making it easier to spot patterns and topics in your knowledge base.

## Secure API Key Storage

Your Google Gemini API keys are now encrypted and stored safely in your operating system's keychain (eg macOS Keychain or Windows Credential Manager) rather than sitting in plain text in your vault folder.

* **Linux Compatibility**: We've included an intelligent fallback mechanism for Linux users. If your system does not have a reachable keychain, the plugin will gracefully fall back to the legacy plain-text storage.

## Quality of Life Improvements

* **Automated Migration**: Your existing API keys will be automatically migrated to secure storage on your primary device.
* **Model Dropdown Fix**: The Researcher view's model selection dropdown now dynamically updates when you refresh the list in the settings, correctly displaying newly available models like Gemini 3.1 Pro.
