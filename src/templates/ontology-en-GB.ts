/**
 * Default templates for the Ontology structure in British English (en-GB).
 */

export const ONTOLOGY_TEMPLATES = {
    CONCEPTS: `
# Concepts
Abstract ideas and theoretical models that form the building blocks of understanding.
Examples: [[Artificial Intelligence]], [[Productivity]], [[Philosophy]].
`.trim(),
    ENTITIES: `
# Entities
Concrete things, people, organisations, or tools.
Examples: [[Python]], [[Obsidian]], [[Gemini]], [[Google]].
`.trim(),
    MOCS: `
# MOCs
Maps of Content (MOCs) are navigational hubs that aggregate and organise thoughts on a specific topic.
Examples: [[My Content Strategy]], [[AI Research Hub]], [[Consulting Playbook]].
`.trim(),
    INSTRUCTIONS: `
# Gardener Instructions
Use this file to steer the Gardener Agent's behavior. The content of this file is appended to the AI's core logic.

### Guidelines
1. **Precision**: Instruct the agent to be conservative or aggressive with new suggestions.
2. **Exclusions**: List concepts or areas you want the agent to avoid (though "gardener: ignore" frontmatter is more targeted).
3. **Reference Style**: Specify how you want definitions and references to be formatted.

### Example Rules
- "Prefer shorter topic names over longer ones."
- "Always suggest at least one tag per note."
- "For technical topics, focus on architectural impact."
`.trim()
};
