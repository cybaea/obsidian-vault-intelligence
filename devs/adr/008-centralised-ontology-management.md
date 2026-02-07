# ADR-008: Centralised ontology management

## Status

Accepted

## Context

Previous iterations of the plugin relied on ad-hoc tagging and disparate notes for context. This "flat" structure made it difficult for the AI to understand the semantic hierarchy or specific classification rules of a user's vault. As we introduced the "Gardener" for automated vault hygiene, the need for a formal "Source of Truth" for concepts, entities, and instructions became critical to prevent the AI from hallucinating categories or creating redundant tags.

## Decision

We introduced a centralised `OntologyService` and a corresponding directory structure within the vault. The ontology serves as the "Knowledge Model" that guides all AI operations.

1.  **Structured Folders**: The ontology is organized into `Concepts/`, `Entities/`, and `MOCs/` (Maps of Content). This provides a clear taxonomy for the AI to follow.
2.  **Interactive Whitelist**: `OntologyService` recursively scans the ontology folder for Markdown files and their `aliases`. This list is used as a "Selection Whitelist" for the Gardener and search systems.
3.  **User-Defined Logic**: An `Instructions.md` file in the ontology root allows users to provide specific classification rules (e.g., "Always file startups under Entities/Organizations") which are injected into the LLM's system prompt.
4.  **Bootstrapping**: The service includes an initialization flow that creates this structure and provides default templates to help users get started.

## Consequences

### Positive

*   **Semantic consistency**: The AI uses the same vocabulary as the user, reducing tag fragmentation.
*   **Low-code customization**: Users can steer the AI's reasoning simply by editing Markdown files in the `Ontology` folder.
*   **Improved accuracy**: Providing structured folder descriptions and topic aliases significantly improves the Gardener's ability to assign correct topics.
*   **Vault portability**: The ontology is just Markdown files, making it fully portable and compatible with other Obsidian tools.

### Negative

*   **Directory overhead**: Requires a specific folder structure which some users might find intrusive.
*   **Maintenance requirement**: The user must keep the ontology somewhat updated for the best results, although the Gardener helps with this.
