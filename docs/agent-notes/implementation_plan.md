# Implementation Plan - Advanced Agent Support

## Goal
Enable support for advanced local embedding models (BGE, Nomic) and implement robust text chunking to handle long documents. This involves updating the settings UI, refactoring the worker for generic model support, managing 1-to-many vector mappings for chunks, and adding model validation.

## User Review Required
> [!IMPORTANT]
> **Vector Store Migration**: Implementing chunking means a single file can now result in multiple vectors. The existing `index.json` and `vectors.bin` structure assumes a 1-to-1 mapping. **This change will require a complete re-indexing of the vault** when the update is applied.
>
> **Model Validation**: Custom model validation requires fetching config files from HuggingFace. This requires an internet connection.

## Proposed Changes

### 1. Settings & UI (`src/settings/sections/models.ts`)
- **Refactor Existing Logic**:
    - Update `modelLabels` and Dropdown options:
        - Small: `MinishLab/potion-base-8M`
        - Balanced: `Xenova/bge-small-en-v1.5`
        - Advanced: `Xenova/nomic-embed-text-v1.5`
        - Custom
    - Maintain existing "custom" logic but enforce `validateModel` check.
- **New Features**:
    - Implement `validateModel(modelId)` logic directly in `models.ts` or `src/utils/validation.ts`.
    - Add "Re-index Vault" button to `models.ts`.
    - Update `onChange` to call `plugin.vectorStore.reindexVault()` or prompt the user.

### 2. Vector Store Architecture (`src/services/VectorStore.ts`)
- **Structure Update**:
    - Update `FileEntry` to support multiple vector IDs: `ids: number[]` instead of `id: number`.
    - Update `index.json` to store the *active model ID*.
- **Logic Update**:
    - `scanVault`: Check if `index.model` matches `settings.embeddingModel`. If not, trigger full re-index.
    - `upsertVector`: Handle replacing *multiple* old vectors with *multiple* new vectors.
    - `deleteVector`: Free all IDs associated with the file.

### 3. Chunking Logic (`src/utils/chunking.ts` - [NEW])
- Implement `recursiveChunking(text, maxTokens)`:
    - Split by paragraphs `\n\n`, then sentences `\n`/`.`, then words.
    - Respect overlap (e.g., 50 tokens) to preserve context at boundaries.
    - Use `tokenizer` (if available) or character heuristic for estimation.

### 4. Worker Enhancements (`src/workers/embedding.worker.ts`)
- **Tokenizer Exposure**: Add message type `count_tokens` to let main thread estimate token usage for chunking? 
    - *Alternative*: Perform chunking *inside* the worker? 
    - *Decision*: **Chunk in Main Thread** is safer for UI responsiveness if generic JS, but **Chunk in Worker** is better because the worker *has* the tokenizer.
    - **Revised Approach**: Pass full text to worker. Worker chunks it. Worker returns `number[][]` (array of vectors).
- **Generic Loader**:
    - Refactor `loadPipeline` to handle general architectures (Bert, NomicBert) without special hacks (except Model2Vec).
    - Ensure `nomic-embed-text-v1.5` uses `{"trust_remote_code": true}` if required (though Transformers.js v3 handles this better, v2 might need `remote_code` polyfill or just rely on supported archs). *Note: Nomic is supported in v2.17.*

### 5. Performance Optimization (`src/services/VectorStore.ts`) [NEW]
- **Inlined Math**: Moved `dotProduct` logic directly into `findSimilar` inner loop to avoid overhead and enable V8 micro-optimizations.
- **Buffer Management**: Implemented capacity-based growth for `Float32Array` (growing by 1.5x) to reduce allocations during high-frequency updates (re-indexing).
- **Subarray Removal**: Optimized vector retrieval by using offsets directly on the main buffer, eliminating `subarray()` view allocations during search.
- **Priority Queuing (NEW)**: Move concurrency management from `VectorStore` to `LocalEmbeddingService`. Use a priority queue to ensure live user requests ("Similar notes") jump ahead of background indexing.
- **Platform-Aware Threading (NEW)**: Use Obsidian's `Platform` detection to scale threads. 1 thread for mobile (battery/thermal safety), 4 threads for desktop (performance).
- **Diagnostic Timing**: Added `logger.debug` timing for similarity search and embedding tasks to identify worker contention.

### 6. Build Fixes (`src/workers/embedding.worker.ts`)
- **BigInt Conversion**: 
    - Fix the `Array.from(rawIds as Iterable<number>)` error by converting `BigInt64Array` token IDs to `number[]` safely: `Array.from(rawIds).map(Number)`.
    - Ensure embedding output `output.data` is safely cast to `Float32Array` or handled via `Array.from(output.data as number[] | Float32Array)` only after verifying it's not `BigInt64Array`.
- **Interface Alignment**: 
    - Refine `FeatureExtractorPipeline` and `PipelineOutput` to accurately represent return types and avoid ambiguous `any` or broad union types that cause `tsc` errors.

## Verification Plan

### Automated Tests
- **Lint & Build Verification**: 
    - **CRITICAL**: Always run `npm run lint && npm run build` sequentially. Passing one is not sufficient.
- **Unit Tests**: Test chunking logic with edge cases (empty strings, huge single words).
- **Integration**: 
    - Switch model -> Verify `index.json` model field updates.
    - Embed long note -> Verify `vectors.bin` grows by >1 vector count.
    - Search -> Verify hits on the 2nd/3rd chunk of a file.

### Manual Verification
1. **Full Re-indexing**: Change to `bge-small`. Click "Re-index Vault". Verify finish without errors.
2. **Dimension Sync**: Verify no "Dimension mismatch" errors after switching from a 384-dim model (BGE) to a 256-dim model (Potion) or vice versa.
3. **Search Verification**: Search for a phrase appearing ONLY at the end of a long note (e.g., >3000 chars).
4. **Log Monitoring**: Verify no "Missing inputs: offsets" errors in the worker log.
