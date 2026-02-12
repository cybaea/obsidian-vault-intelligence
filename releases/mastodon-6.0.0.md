Vault Intelligence brings agentic AI to #Obsidian, turning your static notes into a proactive research partner.

We found performance issues with vaults over 5,000 notes.

Version 6.0.0 is our answer. It's an architectural update. We rebuilt the engine to separate "memory" from "storage", allowing the agent to handle 10,000+ notes effectively.

https://github.com/cybaea/obsidian-vault-intelligence

@obsidian@mas.to #PKM #AI

---

**Pillar 1: Scale**

Handling large vaults requires an efficient architecture. We moved from a monolithic index to a sharded one.

Graph and vector data are now partitioned by model and dimension. This means your "Gemini" index and "Local" index live side-by-side without conflicts or memory spikes.

It scales with your vault.

---

**Pillar 2: Slim-Sync**

Syncing a large index to mobile was problematic for bandwidth.

We introduced "Slim-Sync", splitting the index into "Hot" (vectors + metadata) and "Cold" (content) layers. Only the "Hot" layer syncs by default.

This results in a ~90% reduction in file size. Your phone gets the search capability without the storage overhead, re-hydrating content only when needed.

---

**Pillar 3: State Persistence**

Losing context during a restart is frustrating.

We implemented "Split-Brain" protection and atomic persistence. Even if you restart Obsidian, the agent preserves its state, reasoning chain, and token count.

It makes for a more reliable workflow.

---

Details matter.

We added a dedicated "Storage" dashboard to manage disk usage, cleaned up the "Similar Notes" UI, and fixed startup race conditions.

Faster, lighter, and more reliable.

Thanks to everyone who tested the beta builds.

Get the update now via BRAT.

https://github.com/cybaea/obsidian-vault-intelligence

NOTE: Requires re-indexing your vault.

#Obsidian #KnowledgeManagement #Gemini
