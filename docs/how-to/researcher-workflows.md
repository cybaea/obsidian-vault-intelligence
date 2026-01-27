# Researcher: Workflows

The Researcher is your conversational partner in the vault. Learn how to direct its attention and ask better questions.

## Focusing Attention with Mentions

By default, the Researcher indexes your vault in the background. However, for specific tasks, you should explicitly tell it what to look at using the `@` symbol.

### Mentioning a single note
Type `@` and start typing the name of a note.
-   _Use case:_ "Summarise @Meeting Notes"
-   _Benefit:_ Forces the agent to read that specific file in full.

### Mentioning a folder
Type `@` and select a folder path.
-   _Use case:_ "List all open tasks in @Projects/Alpha"
-   _Benefit:_ Adds all notes in that folder to the context (up to the token limit).

## Effective Querying

The Researcher uses a hybrid search (Keywords + Meaning + Connections).

| Goal | Less Effective | More Effective |
| :--- | :--- | :--- |
| Recall | "Project Alpha" | "What were the key decisions made in Project Alpha last month?" |
| Synthesis | "Compare notes" | "Compare the conclusions in @Paper A and @Paper B." |
| Discovery | "Similar ideas" | "What other concepts in my vault relate to 'Entropy'?" |

## Managing Context

The "Context Window" is the amount of text the AI can read at once.

-   Flash Model: Large window (~1M tokens). Good for dumping entire folders.
-   Pro Model: Smaller window. Best for precise reasoning on specific files.

> [!TIP]
> If the agent seems confused, try clearing the chat history to reset the context.
