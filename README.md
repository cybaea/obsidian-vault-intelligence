# Obsidian Vault Intelligence

![Obsidian Vault Intelligence Social Preview](./public/images/vault-intelligence-social.webp)

When we start taking notes, we are making a promise to our future selves. We carefully write down thoughts, extract highlights, and create links, hoping that one day, when we need that specific spark of insight, we will find it.

But as vaults grow to thousands of notes, they often become digital graveyards. Search becomes a game of guessing the exact keyword you used three years ago. The burden of maintaining tags and folders becomes a part-time job.

Vault Intelligence isn't just a feature upgrade for Obsidian; it is a fundamental shift in how you interact with your knowledge. Its true "soul" is the transformation of your vault from a passive filing cabinet into an active, symbiotic intellectual partner. It doesn't treat your notes as flat text; it understands the shape, structure, and context of your thoughts.

To achieve this, we built Vault Intelligence around four distinct personas that act as stewards of your knowledge:

**1. The Explorer (Finding the Hidden Threads)**

Traditional search is a "bag of words." If you search for "automobile," it won't find notes about "cars." The Explorer understands _meaning_. By combining state-of-the-art semantic vector search with your graph's structural connections, it finds the invisible threads between your ideas. It knows that two notes are related not just because they share text, but because they share a conceptual sibling in your personal ontology. It brings serendipity back to your research.

**2. The Researcher (Your Intellectual Partner)**

Imagine having a research assistant who has memorized every note you’ve ever written. The Researcher doesn't just answer questions; it grounds its reasoning entirely in your vault. If it needs to crunch numbers, it can write and execute Python code. If it needs to verify a real-world fact, it can search the web. But crucially, it is bound by your context. It reads your files, understands your specific terminology, and can even draft or update notes—always asking for your final approval via a "Trust but Verify" prompt before writing a single word.

**3. The Gardener (The Guardian of Your Graph)**

A garden left untended becomes a jungle. The Gardener is a proactive agent that understands your personal ontology. It works in the background, analyzing your notes to find missing tags, suggesting new conceptual links, and proposing structural improvements. It never alters your files silently. Instead, it generates an interactive "Gardening Plan" for you to review, approve, or reject. It takes the chore out of Personal Knowledge Management.

**4. The Solver (Advanced Analysis in your Vault)**

Words are only half the story. If you track habits, log expenses, or compile research data in Markdown tables, that information usually sits dead on the page. The Solver brings it to life. When faced with a complex analytical question, it doesn't just guess—it acts as your personal data scientist. It can read your structured data, write Python code, and execute it inside a secure sandbox to crunch numbers, calculate trends, and forecast outcomes right inside your chat window. It turns static logs into actionable insights.

---

## How It Works (The Technical Edge)

To make this seamless, Vault Intelligence uses a "Slim-Sync" Hybrid Architecture rather than acting as a standard LLM wrapper:

-   **Flexible Privacy** (Local or Cloud): Choose how your vault is mapped. Use the default Gemini embeddings for unmatched multilingual support and mobile performance, or switch to 100% local WASM embeddings to ensure your raw notes never leave your device.
-   **Zero Sync Bloat**: Full vector indexes are kept in your device's local IndexedDB, while only a feather-light blueprint is synced across your devices.
-   **Dynamic Context**: An "Accordion" assembly system dynamically scales from reading full documents to just reading headers, ensuring the AI never hallucinates due to context overload.

📖 **[Read our Vision & Roadmap](https://cybaea.github.io/obsidian-vault-intelligence/VISION.html)** to understand our philosophy, our pivot to local LLMs, and where we are heading next.

---

## Documentation

-   [**Getting Started**](https://cybaea.github.io/obsidian-vault-intelligence/docs/tutorials/getting-started): Connect your API key and run your first query in 5 minutes.
-   [**How-To Guides**](https://cybaea.github.io/obsidian-vault-intelligence/docs/how-to/researcher-workflows): Master specific workflows like data analysis and context management.
-   [**Reference & Troubleshooting**](https://cybaea.github.io/obsidian-vault-intelligence/docs/reference/configuration): Detailed configuration options.
-   [**Explanation**](https://cybaea.github.io/obsidian-vault-intelligence/docs/explanation/research-engine): Understand the Hybrid Search and GARS engine.

## Installation

Currently available in Beta via BRAT:

1.  Install **BRAT** from the Community Plugins store.
2.  In BRAT settings, click **Add Beta plugin**.
3.  Enter: `https://github.com/cybaea/obsidian-vault-intelligence`
4.  Enable Vault Intelligence in your Community Plugins list.

## Contributing

We welcome contributions from developers, designers, and prompt engineers! 

🛠️ **Developers:** Please read our **[Architecture & Standards Guide (`ARCHITECTURE.md`)](ARCHITECTURE.md)** before submitting a pull request to understand our Web Worker constraints, strict SSRF protections, and internal API contracts.

See [CONTRIBUTING.md](CONTRIBUTING.md) for general guidelines.

**License:** MIT
