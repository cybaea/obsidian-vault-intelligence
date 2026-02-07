# ADR-007: The Gardener agent - plan-based vault maintenance

## Status

Accepted

## Context

As an Obsidian vault grows, it often suffers from "entropy": inconsistent naming, missing metadata, or outdated topics. Manually tidying a large vault is tedious. While the `AgentService` provides a chat interface for specific queries, it is not well-suited for systematic, vault-wide hygiene tasks that might affect hundreds of files. Users expressed a need for automated maintenance but were rightfully cautious about letting an AI modify their files without oversight.

## Decision

We implemented the "Gardener" agent, a specialized service (`GardenerService`) designed for proactive vault maintenance. The core design follows a **Plan-Review-Apply** cycle to ensure user control and safety:

1.  **Plan Generation**: The Gardener analyzes a subset of the vault (filtered by recency and exclusion settings) alongside the current ontology. It generates a "Gardener Plan" as a structured JSON object stored within a Markdown file.
2.  **Review (Plan-as-Interface)**: A custom renderer (`GardenerPlanRenderer`) transforms the JSON into an interactive UI. Users can see exactly what changes are proposed (e.g., updating topics, renaming files, adding metadata) and the rationale behind each.
3.  **Selective Application**: Users can toggle individual actions or specific suggested values (like one topic out of three) before clicking "Apply".
4.  **Safe Execution**: The `GardenerService` performs the actual file modifications using the `MetadataManager` for frontmatter and standard Obsidian API for file operations.

## Consequences

### Positive

*   **User safety**: Nothing is modified without explicit "Apply" click after visual review.
*   **Low friction**: Using the "Plan-on-Note" pattern allows the user to review the work at their own pace, even across Obsidian restarts.
*   **Proactive hygiene**: Automates the most tedious part of knowledge management (topic assignment and metadata tagging).
*   **Feedback loop**: The system records which actions were skipped or applied to refine future suggestions (via `GardenerStateService`).

### Negative

*   **Note clutter**: Generates Markdown files in the vault (though these are purged according to retention settings).
*   **Context window limits**: Analyzing a very large vault requires complex chunking and prioritization of files to stay within LLM token limits.
*   **Delayed gratification**: The analysis runs in the background, meaning the "Plan" is not ready immediately upon request.
