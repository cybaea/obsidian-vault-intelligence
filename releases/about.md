# Vault Intelligence: Transform your Obsidian vault into an active research partner

I am excited to share **Vault Intelligence**, a plugin that turns your static note collection into a dynamic knowledge base you can converse with. I built this not just to "add AI" to Obsidian, but to solve the specific problem of synthesis: finding the hidden connections between your ideas and developing them further.

## What is Vault Intelligence?

Vault Intelligence allows you to chat with your vault using Google's Gemini models. Unlike generic chatbots, the **Researcher** agent is grounded in your actual files. It doesn't just answer questions; it cites your work, linking you directly to the paragraphs where your ideas live.

![The Obsidian Sidebar highlighting the Vault Intelligence brain circuit icon](https://raw.githubusercontent.com/cybaea/obsidian-vault-intelligence/main/public/images/screenshots/obsidian-sidebar-icon.png)

## Key Features

### 1. The Researcher: Your Reasoning Engine

The core of the plugin is the Researcher. You can ask it questions like:

> "What do I know about [Topic]?"

Or complex questions like:

> "What are the conflicting arguments about [Topic] in my notes?"

It reads your relevant notes, synthesizes an answer, and provides **citations**. Every claim is backed by a link to your source file.

It has search grounding, so it can verify your information with Google Search. For example:

> "What do I know about [Topic] and is it still relevant and up to date?"

![A chat response showing citations as clickable links](https://raw.githubusercontent.com/cybaea/obsidian-vault-intelligence/main/public/images/screenshots/researcher-citations.png)

### 2. The Gardener: Privacy-First Organization

The Gardener agent helps keep your vault tidy. It uses sophisticated cloud models to determine the best ontology for your notes, ensuring your structure scales as your knowledge grows. While the logic happens in the cloud, you can choose to keep the vector embeddings local for added privacy.

![The Gardener agent planning a vault reorganization](https://raw.githubusercontent.com/cybaea/obsidian-vault-intelligence/main/public/images/screenshots/gardener-plan-ui.png)

### 3. The Solver: Visual Thinking

For problems that need a whiteboard, the Solver visualizes relationships. It can take a complex query and map out the entities and connections in a graph view, helping you see the "shape" of your problem.

![A graph visualization of connected concepts](https://raw.githubusercontent.com/cybaea/obsidian-vault-intelligence/main/public/images/screenshots/solver-graph.png)

### 4. New in 4.3: Active Assistance

The Research Assistant is no longer just a passive observer. It can now **create and update notes** for you—always with a "Trust but Verify" confirmation so you stay in control. It also speaks your language, with native support for dozens of languages and the ability to switch models on the fly for complex reasoning.

## Why Vault Intelligence?

We bring top-tier AI reasoning to your local vault without the hardware cost.

-   **Elite Reasoning on Any Device**: By offloading the heavy lifting to Gemini 3, you get state-of-the-art reasoning without draining your battery or needing a powerful GPU.
-   **Massive Context**: We leverage the massive context window of Gemini 3 to synthesize connections across hundreds of your notes at once.
-   **Multilingual & Grounded**: Synthesize connections across notes in different languages and verify facts against the live web using Google Search.

## Getting Started

I am currently releasing this via BRAT (Beta Reviewers Auto-update Tool) while finalizing the Community Plugins submission.

1.  Install the **BRAT** plugin from the Community Store.
2.  Add the repository: `https://github.com/cybaea/obsidian-vault-intelligence`
3.  Enable **Vault Intelligence** in your community plugins list.
4.  Add your Google AI Studio key in settings.

I would love to hear your feedback on how it changes your workflow!

---
*Links*: [GitHub Repository](https://github.com/cybaea/obsidian-vault-intelligence) | [Documentation](https://cybaea.github.io/obsidian-vault-intelligence/) | [Report Issues](https://github.com/cybaea/obsidian-vault-intelligence/issues)
