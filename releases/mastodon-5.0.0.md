Vault Intelligence 5.0.0 mimics human cognition.

Fast reactions, followed by deep thought. We call it "Dual-Loop Search". 🧠

This release completely rewrites the search architecture to solve the "I can't find my note" problem.

https://github.com/cybaea/obsidian-vault-intelligence

@obsidian@mas.to #PKM #Obsidian

---

Loop 1 is "Reflex Search".

It's instant (<100ms). It runs on your device.

We added **Typo Tolerance** and **Permissive Matching**. If you type "stroy about cats", it finds your note "Cat Stories". It forgives your mistakes and understands your intent.

---

Loop 2 is "Analyst Search".

When you ask the Agent a question, it stops skimming and starts reading.

It uses **Asymmetric Embeddings**—understanding that your query is a *Question* and your notes are *Documents*—and traces metadata bridges to find the "hidden threads" in your vault.

---

We also fixed the noise.

Excalidraw files are great, but their JSON metadata polluted search results. v5.0.0 strips them down to just your text labels.

The result? A 99% smaller index for drawings and a search experience that finds your ideas, not your file coordinates.

---

⚠️ **Important**: v5.0.0 requires a full re-index. Be sure to click "Re-index vault" in settings after updating.

A big thank you to our users who pushed for better search accuracy. This architecture is the direct result of your feedback. 💜

https://github.com/cybaea/obsidian-vault-intelligence
