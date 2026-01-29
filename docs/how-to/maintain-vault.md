# Gardener: Maintain vault hygiene

The Gardener agent helps you keep your vault structured by suggesting topics, links, and tags based on your own ontology.

## Running a hygiene check

1. Open the Command Palette (`Ctrl/Cmd + P`).
2. Search for Gardener: organize vault concepts.
3. Press Enter.

The agent will scan your recent notes (configured in settings) and compare them to your existing folder structure.

## Reviewing the plan

The Gardener never changes your notes without permission. It creates a Gardener Plan file.

1. Open the new generated plan file (e.g., `Gardener/Plans/Plan_2024-03-20`).
2. Review the Action Cards. Each card shows:
    - Source Note: The file being analysed.
    - Suggested Topic: The folder or tag the agent thinks applies.
    - Rationale: Why it thinks so.
3. Uncheck any suggestions you disagree with.
4. Click Apply Changes at the bottom of the note.

    ![The Gardener Plan UI showing action cards and checkboxes](/images/screenshots/gardener-plan-ui.png)

## Customising behaviour

You can teach the Gardener your specific rules by creating an `Instructions.md` file in your ontology folder.

_Example Instructions.md content:_
>
> - Always tag people with #person.
> - Never create topics deeper than 3 levels.
> - Group all programming languages under /Tech.
