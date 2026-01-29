# ADR-004: Greedy Context Packing with Starvation Protection

## Status

Accepted

## Context

Retrieval Augmented Generation (RAG) relies on stuffing relevant notes into the LLM's context window.

* **Problem**: Some Obsidian notes are massive (books, long logs). A naive "Top 5" search might return one 20k-token file that fills the entire budget, squeezing out 4 other highly relevant shorter notes.
* **Goal**: Maximize the _breadth_ of context (number of relevant files) without sacrificing the _depth_ (content of the files) too much.

## Decision

We implemented a **Greedy Packing Algorithm** with **Starvation Protection** (`AgentService.ts`).

1. **Soft Limit**: Define a budget cap per document (e.g., 25% of total context).
2. **Evaluation**:
    * If a document fits in the `Soft Limit`: Include it **in full**.
    * If it exceeds the `Soft Limit`: **clip it**.
3. **Smart Clipping**: When clipping, we don't just take the first N chars. We look for the "Keyword Match" index and extract a window _around_ that keyword.

## Consequences

### Positive

* **Divergent Thinking**: The agent sees a wider variety of sources, leading to better connections and less hallucination.
* **Fairness**: A single massive "Daily Note" doesn't monopolize the conversation.

### Negative

* **Loss of Nuance**: Clipping a long document might remove the crucial paragraph that contradicts the keyword match (e.g., "I used to think [Match], but now I realize that was wrong...").
* **Tokenizer Overhead**: We use character-based heuristics (`CHARS_PER_TOKEN`) to estimate sizing, which is imprecise. We might underfill or overfill the context window.
