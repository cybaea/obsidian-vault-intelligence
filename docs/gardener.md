# Gardener: Intelligence for your vault

The Gardener is an intelligent assistant dedicated to maintaining the health and structure of your Obsidian vault. It proactively analyses your notes to suggest improvements, ensuring your knowledge base remains well-organized and highly interconnected.

## The Problem: Vault Decay

As a vault grows, it naturally tends toward chaos. We forget to add tags, we create duplicate concepts under different names, and we lose the "latent" connections between our ideas. This "Vault Decay" makes your knowledge harder to retrieve and reduces the value of your second brain over time.

## The Solution: Proactive Hygiene

The Gardener alleviates this burden by offering three primary benefits:

1.  **Discovery**: It identifies relevant connections between notes and your existing topics that you might have overlooked.
2.  **Consistency**: It ensures that new topics are properly defined and follow your established organizational patterns.
3.  **Speed**: It can process large batches of recent notes simultaneously, saving you hours of manual cross-referencing.

---

## Getting started: organize vault concepts

To begin using the Gardener, trigger the **Gardener: organize vault concepts** command from the Obsidian Command Palette (`Ctrl/Cmd + P`).

Upon execution, the Gardener will:
1.  Scan your most recently modified notes (up to your configured limit).
2.  Compare their content against your existing ontology.
3.  Generate a **Gardener Plan** document outlining suggested hygiene improvements.

---

## Reviewing the Gardener Plan

Each Gardener Plan is a temporary Markdown document where you can review, adjust, and approve suggested changes.

![Gardener Plan Example](/images/gardener-plan-example.png)
_A typical Gardener Plan showing a summary of suggestions and individual action cards._

### Understanding action cards

Each note requiring attention is presented as an action card:

- **Note Path**: Clickable link to the source note.
- **Topic Changes**: Proposed additions or refinements to the `topics` frontmatter field.
- **Rationale**: A brief explanation from the AI justifying why these changes are suggested.
- **Selection Checkbox**: Use the checkbox to include or exclude the entire note from the final application.

![Action Card Detail](/images/gardener-action-detail.png)
_Detail of an action card proposing a new topic and a link to an existing one._

### Applying changes

Once you are satisfied with the plan, click the **Apply Changes** button at the bottom of the document. The Gardener will then update the frontmatter of all selected notes and automatically prototype any newly proposed topics by creating their corresponding files in your ontology folder.

---

## Configuring the Gardener

You can fine-tune the Gardener's behaviour in the **Ontology** section of the plugin settings.

![Gardener Settings](/images/gardener-settings.png)
_The Gardener configuration section, featuring independent model selection and a customizable system instruction._

### Key settings

- **Gardener model**: Select a dedicated AI model for hygiene tasks. Choosing a highly capable model like Gemini 3 Pro can improve the quality of rationales and definitions.
- **Gardener system instruction**: Define the core persona and rules for the agent. You can use placeholders like `{{ONTOLOGY_FOLDERS}}` to inject your vault structure into the prompt.
- **Gardener analysis limit**: Control how many recent notes are scanned per run.

### Customizing with Instructions.md

For even more granular control, you can create a file named `Instructions.md` within your ontology root folder. The Gardener will automatically read this file and append its contents to its system instructions. This is ideal for defining vault-specific rules, such as:

> "Always categorize people in the `/Entities/People` subfolder."
> "Prefer broader topics over highly specific ones for technical concepts."

---

## Troubleshooting

- **No suggestions found**: The Gardener only suggests changes when it identifies clear improvements. If your notes are already perfectly linked, it will report that the vault is healthy.
- **Missing topic files**: Ensure your **Ontology path** is correctly set in the settings so the Gardener knows where to look for existing topics.
- **JSON errors**: If the AI response is malformed, try switching to a more powerful model or simplifying your custom instructions.
