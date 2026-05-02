# Vault Intelligence 9.0.0

Vault Intelligence is an AI research team for your Obsidian vault.

This is a **massive** update and I am very pleased to finally bring you full local model support via Ollama and extensibility through the Model Context Protocol (MCP).

This was genuinely painful to implement with all the security and robustness, but I hope it is worth it. I still think most users should use cloud models for most use cases, but here you are. MCP is useful for all but I wanted to add it because Ollama does not support search or code tools like our default Gemini models.

**Testers wanted**: please let me have your comments.

## Highlights

- **Local Models (Ollama)**: Full, production-ready support for local AI, allowing you to keep your data entirely on your machine. The agent now handles complex JSON tool-calling reliably.
- **Model Context Protocol (MCP)**: Safely interact with external databases, APIs, and local services using standard MCP servers. Execution is protected by mandatory Trust Hash verification.

**Install via BRAT**: [https://github.com/cybaea/obsidian-vault-intelligence](https://github.com/cybaea/obsidian-vault-intelligence).
