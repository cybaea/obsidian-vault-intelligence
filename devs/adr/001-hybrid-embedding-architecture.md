# ADR-001: Hybrid Embedding Architecture

## Status
Accepted

## Context
The plugin aims to serve two distinct user groups with conflicting needs:
1.  **Privacy-Absolutists**: Users who refuse to send any private note content to a cloud API. They require strictly local processing.
2.  **Power Users**: Users who want the highest quality reasoning, multi-lingual support, and low battery impact (mobile). They prefer cloud APIs (Gemini).

A single implementation cannot satisfy both. Local models (Transformers.js) are heavy on RAM/CPU and often English-only. Cloud models are fast and smart but require network/trust.

## Decision
We implemented a **Strategy Pattern** via `RoutingEmbeddingService`.

*   **Interface**: `IEmbeddingService` defines the contract (`embedQuery`, `embedDocument`).
*   **Implementations**:
    *   `LocalEmbeddingService`: Wraps `Transformers.js` in a Web Worker.
    *   `GeminiEmbeddingService`: Wraps the Google Generative AI API.
*   **Router**: `RoutingEmbeddingService` dynamically delegates calls to the active provider based on user settings.

## Consequences

### Positive
*   **User Choice**: Successfully bridges the gap between privacy and power.
*   **Separation of Concerns**: Chat logic (`AgentService`) doesn't care *how* vectors are made, only that they exist.
*   **Optimized Performance**: Cloud users get zero-overhead indexing. Local users get privacy.

### Negative
*   **State Management Complexity**: Switching providers requires a "Full Re-Index" because vector spaces are not compatible. We had to implement logic to detect model/provider changes and nuke the index.
*   **Inconsistent Experience**: Local users have a worse experience (slower, English-only) than Cloud users. Documenting this discrepancy is a challenge.
*   **Interface Lowest Common Denominator**: The `IEmbeddingService` interface must cater to the limitations of the most restrictive provider (Local).
