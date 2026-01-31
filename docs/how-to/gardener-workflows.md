# Gardener: Workflows

The Gardener agent helps you keep your vault structured by suggesting topics, links, and tags based on your own ontology.

## The Workflow: Plan -> Review -> Apply

The Gardener operates on a safe "human-in-the-loop" model. It will never modify your notes without your explicit approval.

1. **Plan**: The agent scans your notes and proposes changes in a temporary "Plan" file.
2. **Review**: You check the suggestions using an interactive UI.
3. **Apply**: You confirm the changes, and the agent executes them.

## Step 1: Running a hygiene check

1. Open the Command Palette (`Ctrl/Cmd + P`).
2. Search for **Gardener: organize vault concepts**.
3. Press Enter.

The agent will scan your recent notes (configured in settings) and compare them to your existing folder structure and ontology.

## Step 2: Reviewing the plan

Once the scan is complete, a new note will open (e.g., `Gardener/Plans/Plan_2024-03-20`). This note uses a special "Live Preview" rendering mode to show you interactive cards.

### Understanding the Action Cards

Each card represents a suggestion for a single note:

- **Source Note**: The file being analysed.
- **Suggested Topic**: The folder or tag the agent thinks applies.
- **Rationale**: The "why" behind the suggestion.

### Making Decisions

- **Accept**: Verify the card is checked (default).
- **Reject**: Uncheck the card if the suggestion is wrong.
- **Modify**: You can manually move the note yourself if the suggestion gives you a better idea!

![The Gardener Plan UI showing action cards and checkboxes](/images/screenshots/gardener-plan-ui.png)

## Step 3: Applying changes

1. Scroll to the bottom of the plan note.
2. Click the **Apply Changes** button.
3. The agent will move files and add tags as requested.
4. The plan file is automatically archived or deleted based on your retention settings.

## Customising behaviour

You can teach the Gardener your specific rules by creating an `Instructions.md` file in your ontology folder.

_Example Instructions.md content:_

> - Always tag people with #person.
> - Never create topics deeper than 3 levels.
> - Group all programming languages under /Tech.
