Vault Intelligence turns your Obsidian vault into a reasoning engine that researches, cleans, and connects your notes locally.

Messy vaults with duplicate concepts and orphaned files cause friction and degrade AI performance. Version 9.2 helps you with automated vault organisation. Plus added system stability.

Repo: <https://github.com/cybaea/obsidian-vault-intelligence>
@<obsidian@mas.to> #Obsidian #PKM

---

First pillar: Gardener Semantic Merging.

It is easy to end up with multiple notes for the same concept. The Gardener now uses lexical, structural, and semantic vector checks to spot duplicates. You get full oversight before it rewires all your links to merge them safely.

---

Second pillar: Gardener Orphan Pruning.

Abandoned, unlinked topics clutter your search and context limits. Vault Intelligence can now mathematically detect these orphans and propose them for archive or deletion, keeping your knowledge graph focused and relevant.

---

Third pillar: Security and Stability.

We have spent significant time hardening the architecture. This release eliminates persistent memory leaks and patches critical vulnerabilities in the Model Context Protocol (MCP) client, including command injection and SSRF DNS rebinding.

---

Finally, we have overhauled the configuration documentation and exposed advanced controls for Dual-Loop Search and Orphan Management.

A huge thank you to the users who reported the recent security findings and helped us test the patches.

Install now via BRAT: <https://github.com/cybaea/obsidian-vault-intelligence>
