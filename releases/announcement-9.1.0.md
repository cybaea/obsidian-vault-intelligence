# Vault Intelligence 9.1

Vault Intelligence is a different AI plugin for Obsidian. It transforms your vault into a dynamic, self-maintaining knowledge system. It goes beyond simple Q&A by introducing agents that maintain your vault's structure, retrieve information based on your explicit connections, and ground your knowledge in the real world.

This release is focused on our core feature: **The Gardener**. We've made improvements to how the agent understands and maintains your graph.

**Folders as Semantic Context**

If you're an "Architect" who organizes notes with strict folder hierarchies, you'll love this. The graph engine can now treat your physical folders as implicit semantic information (matching your existing ontology by default, or mapping all folders). You no longer need to manually tag every file in a folder to build the relationship.

**The Gardener Cost Optimizer**

Running the Gardener on a mature vault used to mean sifting through hundreds of "no updates" to find the few notes that needed organizing. The new Cost Optimizer intelligently pre-filters your vault, skipping files that are already perfectly aligned with your ontology. It eliminates the noise, speeds up execution, and saves your API context budget.

**Native Link Reading**

The Researcher agent can now natively read external URLs (for Gemini 3.1+ models), bridging the gap between your personal graph and the live web.

🛠️ Plus crucial reliability fixes for agent write-access, context injection, and streaming.

Install via BRAT: <https://github.com/cybaea/obsidian-vault-intelligence>

(Advance "thanks" to all the people who will react with negative emojis: 🅱️ 🅾️ 🅾️ ! Seriously: I appreciate your enthusiasm and respect your views.)
