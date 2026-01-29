# ADR-005: Hybrid Search Merging Strategy

## Status

Accepted

## Context

Users expect search to work like Magic.

* If they search for "Project Alpha", they expect to see the note titled "Project Alpha" at the top (Exact Match).
* If they search for "financial ruin", they expect to see "Bankruptcy" (Semantic Match).
* Pure Vector Search often ranks "Project Beta" higher than "Project Alpha" if the embedding model thinks they are semantically similar corporate gobbledygook.
* Pure Keyword Search fails completely on synonyms.

## Decision

We implemented a **Hybrid Merge & Rank Strategy** (`AgentService.ts`).

1. **Parallel Execution**: We run `GraphService.search()` (Vector) and a custom Keyword Search (Exact Title + Bag-of-Words Body) simultaneously.
2. **Scoring Strategy**:
    * **Vector**: Cosine Similarity (0.0 - 1.0).
    * **Keyword**: Custom heuristic (1.0 for Title, 0.8 for Body Exact, 0.1-0.5 for Fuzzy).
3. **Boosting**: If a document appears in _both_ result sets, we apply a massive boost: `Score = VectorScore * (1 + KeywordScore)`.

## Consequences

### Positive

* **"Best of Both Worlds"**: The user gets the precision of `grep` with the intelligence of LLMs.
* **Trust**: Users trust the tool more when it reliably finds the file they _know_ exists.

### Negative

* **Performance Cost**: We are effectively running two search engines for every query.
* **Tuning Hell**: The "Boost" formula is arbitrary. Why `1 + KeywordScore`? Why not `Weighted Average`? It requires constant tweaking based on user feedback.
* **Complexity**: `AgentService` logic is convoluted with map reductions and score normalization logic.
