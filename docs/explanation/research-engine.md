# The Research Engine

Understanding how Vault Intelligence finds, ranks, and synthesizes information from your notes.

## Hybrid Search Architecture

The Researcher uses a three-stage pipeline to ensure it finds relevant information even if you use different terminology than your notes.

```mermaid
graph TD
    UserQuery([User Query]) --> Stage1
    
    subgraph Stage1 [1. Candidate Retrieval]
        Vector["Vector Search\n(Finds Meaning)"]
        Keyword["Keyword Search\n(Finds Exact Text)"]
    end
    
    Vector --> Pool
    Keyword --> Pool
    
    subgraph Stage2 [2. Graph Analysis]
        Pool[Candidate Pool] --> Evaluation
        Evaluation{Graph\nAnalysis}
    end
    
    Evaluation -- Centrality --> GARS
    Evaluation -- Connections --> GARS
    Evaluation -- Similarity --> GARS
    
    subgraph Stage3 [3. GARS Re-Ranking]
        GARS[Calculate Score] --> Ranked[Final Ranked List]
    end
    
    Ranked --> Agent[Agent Context]
```

## GARS: Graph-Augmented Relevance Score

Most RAG (Retrieval-Augmented Generation) systems only look at similarity (text matching). Vault Intelligence adds two critical dimensions:

1. Similarity: Does the note text match the query?
2. Centrality: Is this note a "hub" or "authority" in your vault structure?
3. Activation: Is this note connected to other relevant notes?

This ensures that a core definition note (eg "Project Alpha MOC") ranks higher than a random daily log mentioning "Project Alpha", even if the daily log has more keyword matches.

## Spotlight candidate scores

When you prompt the Researcher, it first lists a few "Spotlight candidates" retrieved by hybrid search. The number next to each note is a relative relevance score combining semantic similarity, keyword matching, and their overlap. It is not a percentage: values above 100 are normal for notes that match on several signals at once, and only the ordering of the list matters.

## Visual Grounding

Vault Intelligence provides spatial context for the Researcher's reasoning through the Semantic Galaxy.

1. Analysis: The agent identifies notes that support its answer.
2. Projection: These notes are automatically highlighted in the 3D-like galaxy view.
3. Discovery: You can see not just the cited notes, but also the cluster of related ideas physically surrounding them, helping you verify the agent's logic at a glance.

## Privacy and processing

- Local indexing: Your vault's search index is built and stored on your device — the vectors live in your browser's IndexedDB, and a slim MessagePack copy (vectors and graph edges) is kept in the vault's `.vault-intelligence/` folder.
- Provider reasoning: When you chat, only the relevant snippets of text (found by the local index) are sent to the model provider you connected — Google Gemini, Ollama, or an OpenAI-compatible endpoint.
- No Training: Data sent to the Google API is used strictly for generating the response and is not used to train Google's models.
