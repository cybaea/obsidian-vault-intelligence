# Explorer: Find connections

The Explorer view helps you rediscover forgotten notes and find hidden relationships between ideas as you write.

## Opening the Explorer

1.  Click the brain circuit icon in the left ribbon to open the Vault Intelligence menu.
2.  Select **Explorer: view similar notes** to open the list view, or **Explorer: view semantic galaxy** to open the interactive graph.
3.  Alternatively, use the Command Palette (`Ctrl/Cmd + P`) and search for: `Explorer`.

## Finding Similar Notes

The "Similar notes" view provides a prioritized list of related documents. It works automatically based on your current active note.

-   Automatic Updates: As you switch between notes, the Explorer list refreshes to show the most semantically similar content in your vault.
-   Semantic Matching: Unlike standard search, it finds notes that share the same meaning, even if they use different keywords.
-   Relevance Scores: Each suggestion includes a similarity percentage. High scores (eg 85%+) indicate very close conceptual matches.

## The Semantic Galaxy

The Semantic Galaxy is a 3D-like, interactive graph view that complements the similar notes list. While the list view is perfect for quick navigation, the galaxy visualises your vault's relationships in real-time, helping you spot clusters and bridge siloed ideas.

### Opening the Galaxy

You can access the galaxy through the same ribbon menu or via the Command Palette. Using the **Explorer: view semantic galaxy** command will open the graph in a new tab or reveal it if it is already open.

### Interaction and Controls

-   Visual RAG: When the Researcher agent mentions a note in its chat, the note will glow in the galaxy view, helping you "see" the AI's reasoning.
-   Attraction Slider: Use the sidebar slider to adjust the "gravity" of the layout. High attraction pulls related notes into tight clusters, while low attraction allows for a broader, flat view.
-   Reshuffle: Click the reshuffle button to instantly regenerate the layout if the nodes become tangled.
-   Smart Panning: Double-click nodes to navigate to them, or hover to see a native Obsidian preview.

## Use Cases

### Finding the missing link

If you are writing about a new topic and feel like you've mentioned it before, check the Explorer. It might surface a note from two years ago that provides the perfect supporting evidence or a conflicting viewpoint.

### Automated "See Also" sections

Use the Explorer to quickly find notes that should be linked together. Instead of searching, simply look at the top 3 suggestions and add `[[links]]` to bridge your silos.

### Identifying duplicates

If a note shows a 99% similarity to another note, you might have accidentally created a duplicate or a very thin "stub" that should be merged.

## Controlling the Scope

You can adjust how the Explorer calculates similarity in Settings > Explorer.

-   Minimum similarity: Increase this if you only want to see very strong matches.
-   Number of results: Limit this to keep your sidebar clean.
-   Semantic vs Structural: Adjust the weight of the galaxy layout to prioritise existing Wikilinks or hidden vector similarities.

## Folders as semantic topics

Vault Intelligence supports multiple ways to organise your knowledge. While "Gardeners" often use explicit `topics:` properties (Wikilinks) inside their notes, "Architects" often prefer to organise notes by placing them in physical folders (eg `/Projects/Apollo/Meeting.md`).

To bridge this gap, the **Implicit folder semantics** feature allows the plugin to automatically treat your physical folder structure as semantic graph connections. This means notes in the same folder will naturally cluster together in the semantic galaxy and the Researcher agent will understand they share a context.

You can configure how aggressively the plugin interprets your folders via **Settings > Explorer > Implicit folder semantics**.

There are three modes available:

### 1. Ontology (default)

**Best for:** Most users. Keeps your graph clean while intelligently mapping structured folders.

In this mode, the plugin only treats a folder as a semantic topic **if it perfectly matches an existing concept in your Knowledge Base / Ontology.** For example, if you have a folder named `/AI/` and a perfectly matching ontology note named `AI.md`:

-   The plugin will automatically link all notes inside the `/AI/` folder to the `AI.md` concept node.
-   If you have a generic storage folder like `/Archive/` or `/Drafts/` (with no matching ontology note), the plugin will **safely ignore them**. This prevents your graph from being ruined by massive, meaningless "black hole" hubs.

### 2. All (aggressive)

**Best for:** Strict "Architect" users who use folders as their _primary_ tagging system.

In this mode, **every single folder** in your vault is treated as a unique semantic topic, regardless of whether a matching note exists.

-   The plugin will generate "Virtual Nodes" for folders behind the scenes.
-   A note at `/Books/Fantasy/Dune.md` will be strongly linked to the concepts of `Books` and `Fantasy`.
-   **Warning:** If you have generic folders like `/Attachments/` containing hundreds of images, they will form massive visual clusters in the semantic galaxy view.

### 3. None (disabled)

**Best for:** Strict "Gardener" users who rely 100% on explicit YAML properties and Wikilinks.

In this mode, physical folder paths are completely ignored by the graph and the Orama vector engine. A note's location on your hard drive will have zero impact on its semantic similarity scores or its position in the galaxy view.

---

### Tip: preventing duplicate links

If you physically place a note in `/Projects/Apollo/` AND explicitly tag it with `topics: [[Apollo]]` in the frontmatter, the plugin is smart enough to deduplicate the connection. It will prioritise your explicit frontmatter tag (which carries a higher semantic weight) over the implicit folder path.
