# Vault Intelligence 9.2

Vault Intelligence is your AI research assistant that lives securely inside your Obsidian vault, reading, cleaning, and connecting your knowledge natively.

This update adds semantic vault organisation features and important security improvements.

-   Semantic Merging: The Gardener can now **detect conceptually identical topics** across your vault and safely merge them, automatically rewiring all incoming links.
-   Orphan Pruning: Automatically **find disconnected topics and propose them for archival** to keep your ontology organised.
-   Security Updates: Patches for command injection and SSRF DNS rebinding vulnerabilities in the MCP client, alongside fixes for memory leaks.
-   Ollama Reliability: Improved reliability for local streaming models, ensuring tool calls parse correctly even across chunk boundaries.

Install via BRAT: https://github.com/cybaea/obsidian-vault-intelligence

---

Not everyone loves the idea of an AI reading their notes. I get it. But I think Vault Intelligence is different. For me, this is the ideal AI use case. 

-   Low risk: if the ontology was important, you would already have linked your notes manually, right? (Right??)
-   Boring is a feature: scooping up missing connections is not the time to be creative with your ontology; predictable is good. 
-   Human in the loop: easy to include manual checks and approvals.

If you are the person who keeps every note in your vault perfectly organized: more power to you. I am not that person. I wrote this plugin for people like me.