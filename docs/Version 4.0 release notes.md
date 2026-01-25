# Vault Intelligence: True “GraphRAG” comes to Obsidian (New Release)

Hey everyone! 👋

If you’ve ever felt like AI plugins just "keyword search" your notes but miss the **connections** you’ve spent hours building, this update is for you.

We’ve just released a major update to **Vault Intelligence**, moving it from a standard research assistant to a full **Graph-Augmented** engine.

## Why this is different

Most AI plugins are "blind" to your graph—they only see text. **Vault Intelligence** reads your **structure**. It understands that if `Note A` links to `Note B`, they are related context, even if they don't share the same keywords.

## What’s New & Powerful?

1. **Sibling Discovery**: Ever have a daily log that says _"Bug in Project X"_ but the solution is in a completely different note called _"Project X technical specs"_?
	- Old AI: Fails. It doesn't see the connection.
	- Vault Intelligence: It traces the link "up" to the **Project Topic** and "down" to the **Sibling Note**, automatically pulling in the solution. It finds answers through relationships.

**2. Smart Context Window ("The Accordion")**: Stop wasting tokens. The agent dynamically packs context based on relevance:
    - **High Relevance:** Reads the full note.
    - **Medium Relevance:** Reads smart snippets.
    - **Structural Context:** Reads metadata/titles of neighbours without flooding the context window.

## _"But isn't managing a Graph hard?”_

We know you don't always have the time to manually tag every file and maintain your document connections. That’s why we built **The Gardener**.

It’s an AI agent that acts as your **Auto-Pilot for Structure** while keeping you fully in control:

- **It Identifies Gaps:** It scans your vault and finds notes that are disconnected or missing key topics.

- **It Suggests, You Decide:** It never touches your files blindly. It generates a **Gardener Plan**—a tidy checklist of suggested links and structural fixes.

- **One-Click Apply:** You review the plan, uncheck what you don't like, and click "Apply."

**Result:** You get a powerful, interconnected graph suitable for AI analysis _without_ the manual data entry.


## 🛠 The Complete Toolkit

It’s not just for searching. It maintains your vault, too.

- 🌱 **The Gardener:** An agent that analyzes your vault's hygiene. It suggests missing topics, cleans up frontmatter, and helps you maintain a consistent Ontology—all without manual tagging.

- 🌍 **Google Grounding:** Need to check a fact? The agent can verify your notes against live Google Search results.

- 🧮 **Computational Solver:** It writes and executes Python code to solve math or logic problems inside your chat.
    

##  Powered by Gemini (Why an API Key?)

We use Google Gemini 3 (via API key) for the heavy reasoning tasks. Why?

- **Runs on Anything:** Get massive reasoning power even on older laptops or tablets without draining your battery or melting your CPU.

- **Native Multilingual:** Research seamlessly across dozens of languages with top-tier fluency.

- **Hybrid Privacy:** While reasoning happens in the cloud, the **Vector Search** runs 100% locally on your device for speed.

- Future versions of Vault Intelligence will support local models.



**Give it a try and let your graph actually do the work.**

Install via BRAT: https://github.com/cybaea/obsidian-vault-intelligence/

---

_New in this version: Advanced GARS (Graph-Augmented Relevance Scoring) tuning, Ontology Sibling Traversal, improved local embedding performance, and the introduction of the Gardener agent._