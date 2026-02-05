# 5.0.0 — The Dual-Loop Update

This release rewrites the search architecture to mimic human cognition: fast reflexes followed by deep thought. We call it **Dual-Loop Search**.

Alongside this, we've solved the "I can't find my note" frustration with asymmetric embeddings and fuzzy matching, ensuring you find what you're looking for even if you make a typo or use different phrasing.

> [!WARNING]
> **Action Required: Re-Index Your Vault**
> Because we have changed the fundamental way vectors are calculated (switching to Asymmetric Embeddings), your old index is incompatible with this version.
> 1. Update the plugin.
> 2. Go to **Settings** > **Explorer**.
> 3. Click **Re-index vault**.

## 🚀 Dual-Loop Search Architecture

We have split the search experience into two distinct cognitive loops:

*   **Loop 1: Reflex Search (The "Spotlight")**
    *   **Instant (<100ms)**: Results appear as you type.
    *   **Local Hybrid**: Powered by a new on-device engine that blends permissive keyword matching with lightweight vector scanning.
    *   **Typo Tolerance**: The engine now handles "fuzzy" queries. Searching for `storis` will correctly find `stories`, making the UI feel robust and forgiving.

*   **Loop 2: Analyst Search (The Agent)**
    *   **Deep Reasoning**: When you ask the Agent a question, it engages the "Deep" loop.
    *   **Deep Recall**: It scans semantic "hidden threads" (bridging notes via `topics`, `tags`, `author`) to gather a broad set of candidates.
    *   **Re-Ranking**: It then uses Gemini to re-rank these candidates based on true semantic relevance, ensuring it reads the *right* notes before answering.

## 🧠 Intelligence Upgrades (The "Fixes")

Three major changes ensure that "Search" actually means "Find".

*   **Asymmetric Embeddings**: Previously, notes and queries were treated the same. Now, we explicitly distinguish them: queries are embedded as **Questions** and notes as **Documents**. This aligns with how modern models (like Gemini) are trained, drastically improving retrieval accuracy.
*   **Permissive Natural Language**: We replaced strict keyword matching with a logical OR strategy. A query like *"Where are my stories about cats?"* will now find a note containing just *"Cat"*, even if *"stories"* is missing.
*   **Zero-Noise Excalidraw**: We now strips away internal JSON from drawing files before indexing. Your search results are no longer polluted by metadata, matching only the text labels you actually wrote.

## 🏗️ Architecture & Stability

*   **Worker Authority**: The background worker is now the "Single Source of Truth," eliminating split-brain bugs where search results didn't match file contents.
*   **Self-Healing Vault**: Changing your embedding model or search dimensions now automatically triggers the necessary re-indexing.
*   **Persistence Manager**: A dedicated system now handles index serialization, ensuring data integrity and faster startup times.

## Quality of Life

*   **Keyword Match Calibration**: Fine-tune the balance between exact keyword matches and conceptual matches in Explorer settings.
*   **Tuning Resets**: granular reset buttons for Advanced Settings.
*   **Crash loop fix**: Resolved a race condition that could cause re-indexing loops on startup.
