Vault Intelligence brings AI to #Obsidian as a dedicated research assistant. This update brings autonomy to your vault: full local AI support to keep your data on your machine, combined with the ability to safely query your external APIs.

https://github.com/cybaea/obsidian-vault-intelligence
@obsidian@mas.to #PKM #Obsidian #OSS MIT Licence

---

First up: Local Models. We've added full, production-ready support for Ollama. By building a custom JSON lexer to parse outputs, local models can now reliably execute complex tool loops and stream responses token-by-token without breaking the interface.

---

Next: The Model Context Protocol (MCP). The agent can now securely connect to any standard MCP server (local or remote) to use specific tools or inject resources into its memory. To keep this safe, we’ve mandated OS-encrypted secrets and strict Trust Hashing to prevent unauthorized execution.

---

Behind the scenes, the chat rendering engine has been completely rebuilt for speed and stability. Responses now stream smoothly without layout stutter, and we've added native support for Gemini 3.1's web grounding so web searches happen seamlessly in the main loop.

---

A huge thank you to everyone who tested these architectural changes and submitted bug reports over the past weeks. Your feedback has been invaluable in making this stable.

You can install the update via BRAT to try it out.
https://github.com/cybaea/obsidian-vault-intelligence

#AI #KnowledgeManagement #OpenSource #Productivity
