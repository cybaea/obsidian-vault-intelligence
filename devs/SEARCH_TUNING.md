# GARS Search and Context Tuning Guide

This document explains the technical parameters in the **Search and context tuning** section of the Advanced Settings. These values govern the **Graph-Augmented Relevance Score (GARS)** and the **Context Assembly** logic.

## 1. Search expansion

### Expansion trigger threshold (Default: 0.70)

Determines which search results are "strong" enough to trigger a graph neighbor expansion.

- **How it works**: If the top search result has a score of 10.0, any result with a score >= 7.0 (70%) will have its neighbors (linked notes, topic siblings) pulled into the candidate pool.
- **Tuning**: Lowering this (eg to 0.50) creates a broader, more exploratory search. Raising it (eg to 0.90) makes the search tighter and more focused on direct matches.

### Expansion seeds limit (Default: 5)

A safety cap on how many documents can trigger expansion.

- **How it works**: Even if 20 documents pass the threshold, only the top 5 will actually have their neighbors expanded.
- **Tuning**: Increase for very dense repositories where relationships are more important than text. Decrease if background indexing performance is a concern.

### Absolute expansion floor (Default: 0.40)

The absolute minimum score required for any expansion.

- **How it works**: If your search results are weak (vague queries), the system will not expand neighbors for results scoring below this floor, preventing "fishing" for irrelevant connections.

## 2. Context assembly (the accordion)

The system uses **Relative Relevance** to decide how much of a note to show the AI. This is calculated as a percentage of the top match's score.

### Primary threshold (Default: 0.90)

- **Action**: Full file body is included.
- **Logic**: These are high-confidence matches that are nearly as relevant as the top result.

### Supporting threshold (Default: 0.70)

- **Action**: Extracts contextual snippets around query terms.
- **Logic**: These notes provide useful background or supporting evidence but aren't the main answer.

### Structural threshold (Default: 0.35)

- **Action**: Displays only the note structure (headers) as a "Table of Contents".
- **Logic**: These are peripheral notes or graph neighbors. They provide structural context without bloating the prompt.
- **Cap**: This mode is strictly capped at the top 10 matches to prevent metadata noise.

## 3. Advanced weights

### Spreading activation weight (Default: 0.25)

Determines how much "bonus" score a graph neighbor receives from its parent match.

- **Logic**: If Note A matches the query, its neighbor Note B receives 25% of Note A's score automatically.
- **Tuning**: Increase to 0.50 to make the AI much more aware of "connectedness". Decrease to 0.10 if you want the AI to stay strictly within the search results.

### Neighbor decay (Default: 0.30)

The penalty applied as you move further away in the graph.

- **Logic**: Every hop away from a direct search match reduces the activation bonus by this factor.
- **Tuning**: Leave at 0.30 for calibrated behavior in most vaults.

## 4. Domination prevention

### Single doc soft limit (Default: 0.10)

Prevents a single large "Primary" document from accidentally crowding out other relevant results in the context window.

- **Logic**: Even if a document is a 100% match, it is "soft-capped" at 10% of the total context budget if other relevant documents are available. This ensures the AI always has a diverse set of sources to draw from.

## 5. Deep Recall & Hybrid Logic

### Candidate Retrieval

The system now retrieves **all** reasonable semantic matches (`similarity: 0.001`) from the vector index before filtering.

- **Why**: Standard vector search cutoffs (eg 0.8) often hide relevant supporting concepts. We trust our internal re-ranking (GARS) more than the raw vector score.

### Keyword Normalization

Matches from full-text search are now normalized **locally** within their result batch before being merged.

- **Tuning**: The `Keyword Weight` setting (default 1.2) controls how aggressively high-scoring keyword matches can boost a vector result.
    - Increase this if you find the system ignores exact phrase matches.
    - Decrease if keyword matches are overpowering semantic context.

### Post-Retrieval Filtering

The `Minimum Similarity Score` setting is applied **after** the hybrid merge and GARS scoring.

- **Implication**: You can safely look for "everything" (Deep Recall) for graph analysis while still only showing the user "good" results (Precision). The graph worker sees the noisy candidates to build connections; the user sees the clean output.
