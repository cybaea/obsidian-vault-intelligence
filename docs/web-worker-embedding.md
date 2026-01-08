# Web Worker Embedding Implementation

This document provides a technical overview of how local embeddings are implemented in Vault Intelligence using `@xenova/transformers` (Transformers.js) inside a Web Worker.

## Overview of Approach

The plugin uses a **Web Worker** to perform embedding generation off the main thread. This ensures that the Obsidian UI remains responsive even when processing large amounts of text or loading heavy models.

### Architecture
- **`LocalEmbeddingService.ts`**: The main-thread service that manages the life cycle of the worker. It handles initialization, message queueing (via `pendingRequests` Map), and termination.
- **`embedding.worker.ts`**: The worker code that runs the Transformers.js pipeline.
- **`esbuild-plugin-inline-worker`**: Used to bundle and inline the worker script directly into `main.js`. This simplifies plugin distribution as it remains a single file.

## Key Technical Issues Overcome

### 1. Model2Vec "Missing Offsets" Error
Model2Vec models (like `potion-base-8M`) require an `offsets` tensor that Transformers.js v2 does not automatically calculate for all model types. 
- **Solution**: Implemented a specialized `loadModel2Vec` function in the worker that manually calculates token offsets and passes them explicitly to the ONNX model.

### 2. Browser Environment Detection in esbuild
Transformers.js tries to detect if it's running in Node or Browser. Because Obsidian is an Electron app, it often incorrectly detects Node, leading to attempts to use `fs` which fail in a Worker.
- **Solution**: Forced browser detection in `esbuild.config.mjs` by defining `process.release.name = 'browser'` and `process.versions.node = 'false'`.

### 3. WASM Loading & CDN Paths
In a Web Worker, relative paths to WASM binaries often resolve incorrectly.
- **Solution**: Hardcoded explicit CDN paths to `jsdelivr` for the ONNX Runtime WASM files to ensure consistent loading regardless of the user's filesystem structure.

### 4. Memory Management (OOM Mitigation)
Loading large models or indexing thousands of files can pressure the 4GB V8 heap limit.
- **Solution**: 
  - Implemented a `PipelineSingleton` in the worker to prevent multiple model instances.
  - Optimized `VectorStore.ts` with chunked buffer growth and automatic buffer shrinking.
  - Added aggressive cleanup (`worker.terminate()`) in the plugin's `onunload`.

## Remaining 'Hacks' & Future Maintenance

- **`mockPlugin` in esbuild**: We mock Node modules (`fs`, `path`, etc.) to empty objects to satisfy esbuild. If Transformers.js adds new Node-specific dependencies, this list may need updating.
- **Hardcoded CDN Versions**: The WASM paths are pinned to `@2.17.2`. When upgrading `@xenova/transformers`, these URLs **must** be updated manually in `embedding.worker.ts`.
- **Manual Offsets**: The Model2Vec offset logic is a workaround for a limitation in Transformers.js v2. It should be re-evaluated when upgrading to v3 (Hugging Face Transformers.js).

## Debugging and Testing

### Connecting to the Worker
The worker runs in a separate thread. To see its logs:
1. Launch Obsidian with remote debugging:
   ```bash
   # Example for Flatpak
   flatpak run md.obsidian.Obsidian --remote-debugging-port=9223
   ```
2. In your browser, navigate to `http://localhost:9223`.
3. Find the entry labeled `blob:app://obsidian.md/...` (this is the worker).
4. Click it to open a dedicated DevTools window for the worker.

### Forcing a Model Redownload
If the model is corrupted or stuck, use the "Force Redownload" feature in settings. This clears the `transformers-cache` in Browser Cache Storage and restarts the worker.

## Suggestions for Next Steps
1. **Text Chunking**: Currently, the entire document is sent as a single string. Implementing a chunking strategy (e.g., recursive character splitting or sentence-based) is critical for handling long notes without truncation.
2. **Quantization Support**: Investigate why some specialized models fail to find `.onnx` quantized files on the CDN and provide better local fallbacks.
3. **Worker Pool**: For very high-throughput indexing, consider a pool of 2 workers, though memory pressure must be carefully monitored.
4. **Progress Reporting**: Add a progress callback from the worker to the main thread during the ONNX `model()` call for better UI feedback during long inferences.
