# ADR-003: Progressive Stability Degradation for Local Embeddings

## Status

Accepted

## Context

Running BERT-sized models (e.g., `nomic-embed-text`) in the browser via WebAssembly (WASM) is cutting-edge but fragile.

* **Hardware Variance**: Some users have GPUs/SIMD support; others are on 5-year-old laptops.
* **Browser/Electron flakiness**: Multi-threaded WASM is experimental in some Electron versions.
* **Crash Loops**: If a model fails to load or crashes the worker, naively retrying sends the user into an infinite crash loop.

## Decision

We implemented a **Circuit Breaker with Progressive Degradation** in `LocalEmbeddingService`.

1. **Monitor**: We track worker crashes and "Early Boot Failures".
2. **Degrade**: If a crash occurs:
    * **Attempt 1**: Restart normally.
    * **Attempt 2**: Disable Multi-threading (Force 1 thread).
    * **Attempt 3**: Disable SIMD (Single Instruction, Multiple Data).
3. **Circuit Break**: If it still crashes, we permanently disable the worker and notify the user to switch to Cloud.

## Consequences

### Positive

* **Resilience**: The plugin "just works" eventually, even on potato-quality hardware, by finding the lowest stable configuration.
* **Safety**: Prevents the plugin from crashing the entire Obsidian app repeatedly.

### Negative

* **Performance Hit**: Fallback modes (No SIMD, 1 Thread) are _significantly_ slower (10x-20x). Users in this state might perceive the plugin as "broken" rather than "safe".
* **Debug Difficulty**: It is hard to know from a bug report if a user is running effectively (SIMD enabled) or in fallback mode without explicit logs.
* **Code Complexity**: The state machine for managing retries and configuration overrides is complex and prone to edge cases.
* **GPU Support**: The version of Transformers.js we use doesn't support GPU acceleration. We should upgrade to a more recent version.
