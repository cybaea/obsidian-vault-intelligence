import { env } from '@huggingface/transformers/src/env.js';
import { AutoModel } from '@huggingface/transformers/src/models/auto/modeling_auto.js';
import { AutoTokenizer } from '@huggingface/transformers/src/models/auto/tokenization_auto.js';
import { FeatureExtractionPipeline } from '@huggingface/transformers/src/pipelines/feature-extraction.js';
import { Tensor } from '@huggingface/transformers/src/utils/tensor.js';

import { WORKER_CONSTANTS } from '../constants';
import {
    ConfigureMessage,
    EmbedMessage,
    TransformersEnv,
    WorkerErrorResponse,
    WorkerSuccessResponse
} from '../types/worker.types';
import { logger } from '../utils/logger';
import { isSafeUrl } from '../utils/url';

// --- 1. Strong Typing for Environment ---
// Cast env for safe configuration
const safeEnv = env as unknown as TransformersEnv;

// --- 3. Configure Environment ---
safeEnv.useFS = false;
safeEnv.allowLocalModels = false;
safeEnv.useBrowserCache = true;

// Initialize backends structure safely
if (!safeEnv.backends) safeEnv.backends = {};
if (!safeEnv.backends.onnx) safeEnv.backends.onnx = {};
if (!safeEnv.backends.onnx.wasm) safeEnv.backends.onnx.wasm = {};

// Setting the onnxruntime-web WASM CDN paths
safeEnv.backends.onnx.wasm.wasmPaths = WORKER_CONSTANTS.WASM_CDN_URL;

safeEnv.backends.onnx.wasm.numThreads = 1; // Default to safe single thread
safeEnv.backends.onnx.wasm.simd = true;
safeEnv.backends.onnx.wasm.proxy = false;

// --- 4. Fetch Proxy Implementation ---
const pendingFetches = new Map<number, { resolve: (resp: Response) => void, reject: (err: Error) => void }>();
let fetchRequestId = 0;

export const timer = (() => {
    const globalRef = self as unknown as Record<string, unknown>;
    if (typeof globalRef.activeWindow !== 'undefined') {
        return globalRef.activeWindow as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
    }
    return self as unknown as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
})();

// Override global fetch to proxy through main thread (bypasses Obsidian CSP/CORS)
const originalFetch = self.fetch;
self.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();

    // Only proxy HuggingFace or remote calls. Local WASM paths should use original fetch (cached)
    if (!url.startsWith('http')) {
        return originalFetch(input, init);
    }

    return new Promise((resolve, reject) => {
        const requestId = fetchRequestId++;

        // --- Smart Timeout Implementation ---
        // 1. Determine timeout based on context (Model weights vs API/Metadata)
        // Allow longer timeout for model assets (.onnx, .bin, .wasm, .msgpack, etc.) to support slow connections
        const IS_HEAVY_ASSET = ['.onnx', '.bin', '.wasm', '.msgpack'].some(ext => url.toLowerCase().endsWith(ext)) || url.includes('huggingface.co');
        const TIMEOUT_MS = IS_HEAVY_ASSET ? WORKER_CONSTANTS.HEAVY_ASSET_TIMEOUT_MS : WORKER_CONSTANTS.API_REQUEST_TIMEOUT_MS;

        const timeoutId = timer.setTimeout(() => {
            if (pendingFetches.has(requestId)) {
                pendingFetches.delete(requestId);
                reject(new Error("Fetch proxy request " + requestId + " (" + url + ") timed out after " + (TIMEOUT_MS / 1000) + "s."));
            }
        }, TIMEOUT_MS);

        const wrappedResolve = (resp: Response) => {
            timer.clearTimeout(timeoutId);
            resolve(resp);
        };

        const wrappedReject = (err: Error) => {
            timer.clearTimeout(timeoutId);
            reject(err);
        };

        pendingFetches.set(requestId, { reject: wrappedReject, resolve: wrappedResolve });

        // Properly convert Headers to Record
        const headers: Record<string, string> = {};
        if (init?.headers) {
            if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => {
                    headers[key] = value;
                });
            } else if (Array.isArray(init.headers)) {
                init.headers.forEach(([key, value]) => {
                    headers[key] = value;
                });
            } else {
                Object.assign(headers, init.headers);
            }
        }

        // --- Header Sanitization ---
        // Aggressively strip Authorization headers for HuggingFace and Public CDNs 
        // as they cause 401s if malformed or present on public models.
        if (isSafeUrl(url)) {
            delete headers['authorization'];
            delete headers['Authorization'];
        } else {
            // Standard cleanup for other URLs
            if (headers['authorization']?.includes('undefined') || !headers['authorization']) {
                delete headers['authorization'];
            }
            if (headers['Authorization']?.includes('undefined') || !headers['Authorization']) {
                delete headers['Authorization'];
            }
        }

        ctx.postMessage({
            body: init?.body,
            headers,
            method: init?.method || 'GET',
            requestId,
            type: 'fetch',
            url
        });
    });
};

// --- Strict Types ---
interface TokenizerResult {
    attention_mask?: TokenIds;
    input_ids?: TokenIds;
}

type TokenIds = number[] | BigInt64Array | Tensor;

interface CustomTokenizer {
    (text: string, options?: { add_special_tokens?: boolean; return_tensor?: boolean }): TokenizerResult;
    decode(tokens: TokenIds, options?: { clean_up_tokenization_spaces?: boolean; skip_special_tokens?: boolean }): string;
}

interface CustomPipeline {
    (text: string | string[], options?: { normalize?: boolean; pooling?: 'mean' }): Promise<{ data: ArrayLike<number> }>;
    dispose(): Promise<void>;
    tokenizer: CustomTokenizer;
}

interface CustomModel {
    (model_inputs: unknown): Promise<Record<string, Tensor>>;
    dispose(): Promise<void>;
}

// Type for our unified extractor function
type ChunkedExtractor = (text: string | string[]) => Promise<{ vectors: number[][], tokenCount: number }>;

// --- 5. Global Error Handling ---
// Catch errors from sub-workers (like ONNX) or unhandled rejections
self.addEventListener('error', (e: ErrorEvent) => {
    let detail = 'Internal error';
    if (e.error) {
        if (e.error instanceof Error) {
            detail = e.error.name + ': ' + e.error.message + '\n' + e.error.stack;
        } else if (typeof e.error === 'object') {
            // Handle objects that stringify poorly (like events)
            detail = JSON.stringify(e.error, Object.getOwnPropertyNames(e.error));
        } else {
            detail = String(e.error);
        }
    }
    logger.error("[Worker] Global Error:", {
        colno: e.colno,
        error: detail,
        filename: e.filename,
        lineno: e.lineno,
        message: e.message
    });
});

self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    let detail = 'No reason provided';
    if (e.reason) {
        if (e.reason instanceof Error) {
            detail = e.reason.name + ': ' + e.reason.message + '\n' + e.reason.stack;
        } else if (typeof e.reason === 'object') {
            detail = JSON.stringify(e.reason, Object.getOwnPropertyNames(e.reason));
        } else {
            detail = String(e.reason);
        }
    }
    logger.error("[Worker] Unhandled Rejection:", {
        reason: detail
    });
});

// --- Helper for Event Loop Yielding ---
// Forces the worker to "breathe" and allow the browser/host to see it is still alive.
async function yieldToEventLoop() {
    return new Promise(resolve => timer.setTimeout(resolve, 0));
}

// Track active pipeline for cleanup
let activePipelineInstance: { dispose(): Promise<void> } | null = null;

interface ProgressInfo {
    file?: string;
    progress?: number;
    status: string;
}

// --- Pipeline Singleton ---
class PipelineSingleton {
    static task = 'feature-extraction' as const;
    static instance: Promise<ChunkedExtractor> | null = null;
    static currentModel: string = '';
    static currentQuantized: boolean = true;

    static async getInstance(model: string, quantized: boolean = true): Promise<ChunkedExtractor> {
        if (this.currentModel && (this.currentModel !== model || this.currentQuantized !== quantized)) {
            logger.debug("[Worker] Model/Config changed. Cleaning up previous pipeline instance.");
            if (activePipelineInstance && typeof activePipelineInstance.dispose === 'function') {
                try {
                    await activePipelineInstance.dispose();
                } catch (e) {
                    logger.error("[Worker] Failed to dispose previous pipeline instance:", e);
                }
            }
            activePipelineInstance = null;
            this.instance = null;
        }

        if (this.instance === null) {
            this.currentModel = model;
            this.currentQuantized = quantized;

            const progress_callback = (progress: ProgressInfo) => {
                const status = progress.status === 'download' ? 'downloading' : progress.status;
                if (['progress', 'initiate', 'downloading', 'done'].includes(status)) {
                    ctx.postMessage({
                        file: progress.file || '',
                        progress: progress.progress || 0,
                        status: status,
                        type: 'progress'
                    });
                }
            };

            this.instance = (async () => {
                try {
                    return await this.createChunkedExtractor(model, quantized, progress_callback);
                } catch (err) {
                    PipelineSingleton.instance = null;
                    throw err;
                }
            })();
        }

        return this.instance;
    }

    private static async createChunkedExtractor(modelName: string, quantized: boolean, progress_callback: (p: ProgressInfo) => void): Promise<ChunkedExtractor> {
        if (modelName.includes('potion') || modelName.includes('model2vec')) {
            return this.loadModel2Vec(modelName, quantized, progress_callback);
        }

        // Lock precision strictly to setting-mandated level (q8 or fp32)
        const targetDtype = quantized ? 'q8' : 'fp32';
        let pipe: CustomPipeline | null = null;

        try {
            const tokenizer = await AutoTokenizer.from_pretrained(modelName, { progress_callback });

            // Dynamic Device Allocation: Try WebGPU first, then fall back to WASM if initialization rejects
            try {
                logger.info("[Worker] Attempting pipeline initialization on WebGPU with precision: " + targetDtype);
                const model = await AutoModel.from_pretrained(modelName, {
                    device: 'webgpu',
                    dtype: targetDtype,
                    progress_callback,
                });
                pipe = new FeatureExtractionPipeline({
                    model: model,
                    task: this.task,
                    tokenizer: tokenizer
                }) as unknown as CustomPipeline;
            } catch (webGpuError) {
                const errorMsg = webGpuError instanceof Error ? webGpuError.message : String(webGpuError);
                // Check for network/asset loading failures (404, CORS, failed to fetch, offline)
                const isNetworkOrAssetError = /404|fetch|network|cors|status|http/i.test(errorMsg);
                if (isNetworkOrAssetError) {
                    logger.error("[Worker] WebGPU failed due to network/asset error, aborting without WASM fallback: " + errorMsg);
                    throw webGpuError;
                }

                logger.warn("[Worker] WebGPU initialization failed or unsupported (" + errorMsg + "). Falling back to WASM...");
                try {
                    const model = await AutoModel.from_pretrained(modelName, {
                        device: 'wasm',
                        dtype: targetDtype,
                        progress_callback,
                    });
                    pipe = new FeatureExtractionPipeline({
                        model: model,
                        task: this.task,
                        tokenizer: tokenizer
                    }) as unknown as CustomPipeline;
                } catch (wasmError) {
                    // If quantized WASM fails with a 404, retry unquantized
                    const msg = wasmError instanceof Error ? wasmError.message : String(wasmError);
                    if (quantized && msg.includes("404")) {
                        logger.warn("[Worker] Quantized model asset not found. Retrying unquantized (fp32) on WASM...");
                        const model = await AutoModel.from_pretrained(modelName, {
                            device: 'wasm',
                            dtype: 'fp32',
                            progress_callback,
                        });
                        pipe = new FeatureExtractionPipeline({
                            model: model,
                            task: this.task,
                            tokenizer: tokenizer
                        }) as unknown as CustomPipeline;
                    } else {
                        throw wasmError;
                    }
                }
            }
        } catch (err) {
            logger.error("[Worker] Failed to initialize pipeline components:", err);
            throw err;
        }

        activePipelineInstance = pipe;

        return async (input: string | string[]) => {
            const texts = Array.isArray(input) ? input : [input];
            const allVectors: number[][] = [];
            let totalTokenCount = 0;

            for (const text of texts) {
                if (!pipe) throw new Error("Pipeline not initialized");
                const tokenizer = pipe.tokenizer;
                const MAX_TOKENS = 512;
                const CHUNK_SIZE = MAX_TOKENS - 2;

                const MAX_CHARS_PER_TOKENIZATION_BLOCK = 10000;
                const input_ids: number[] = [];

                for (let i = 0; i < text.length; i += MAX_CHARS_PER_TOKENIZATION_BLOCK) {
                    const segment = text.slice(i, i + MAX_CHARS_PER_TOKENIZATION_BLOCK);
                    try {
                        const result = tokenizer(segment, { add_special_tokens: false });
                        const segmentIds = result.input_ids || (result as unknown as TokenIds);

                        let data: ArrayLike<number | bigint>;
                        if (segmentIds instanceof Tensor) {
                            data = segmentIds.data as ArrayLike<number | bigint>;
                        } else {
                            data = segmentIds;
                        }
                        input_ids.push(...Array.from(data).map(num => Number(num)));
                    } catch (e) {
                        logger.error("[Worker] Tokenization failed:", e);
                        throw e;
                    }
                    await yieldToEventLoop();
                }

                if (input_ids.length === 0) continue;
                totalTokenCount += input_ids.length;

                for (let i = 0; i < input_ids.length; i += CHUNK_SIZE) {
                    const chunkIds = input_ids.slice(i, i + CHUNK_SIZE);
                    try {
                        const chunkText = tokenizer.decode(chunkIds, {
                            clean_up_tokenization_spaces: true,
                            skip_special_tokens: true
                        });

                        if (!chunkText.trim()) continue;

                        const output = await pipe(chunkText, { normalize: true, pooling: 'mean' });
                        allVectors.push(Array.from(output.data));
                    } catch (e) {
                        logger.error("[Worker] Inference failed:", e);
                        throw e;
                    }
                    await yieldToEventLoop();
                }
            }

            return {
                tokenCount: totalTokenCount,
                vectors: allVectors
            };
        };
    }

    private static async loadModel2Vec(modelName: string, quantized: boolean, progress_callback: (p: ProgressInfo) => void): Promise<ChunkedExtractor> {
        logger.debug("[Worker] Loading Model2Vec: " + modelName + " (quantized=" + quantized + ")");
        const tokenizer = await AutoTokenizer.from_pretrained(modelName, { progress_callback }) as unknown as CustomTokenizer;
        let model: CustomModel;

        const targetDtype = quantized ? 'q8' : 'fp32';

        try {
            model = await AutoModel.from_pretrained(modelName, {
                dtype: targetDtype,
                progress_callback,
            }) as unknown as CustomModel;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (quantized) {
                logger.warn("[Worker] Failed to load model2vec quantized: " + msg + ". Retrying unquantized...");
                model = await AutoModel.from_pretrained(modelName, {
                    dtype: 'fp32',
                    progress_callback,
                }) as unknown as CustomModel;
            } else {
                throw err;
            }
        }

        activePipelineInstance = model;

        return async (input: string | string[]) => {
            const texts = Array.isArray(input) ? input : [input];
            const allVectors: number[][] = [];
            let totalTokenCount = 0;

            for (const text of texts) {
                const MAX_TOKENS = 512;
                const MAX_CHARS_PER_TOKENIZATION_BLOCK = 10000;
                const input_ids: number[] = [];

                for (let i = 0; i < text.length; i += MAX_CHARS_PER_TOKENIZATION_BLOCK) {
                    const segment = text.slice(i, i + MAX_CHARS_PER_TOKENIZATION_BLOCK);
                    const result = tokenizer(segment, { add_special_tokens: false, return_tensor: false });
                    const segmentIds = result.input_ids;
                    if (!segmentIds) throw new Error("Missing input_ids in tokenizer result");
                    input_ids.push(...Array.from(segmentIds).map(num => Number(num)));
                    await yieldToEventLoop();
                }

                if (input_ids.length === 0) continue;
                totalTokenCount += input_ids.length;

                const idsArray = input_ids;

                for (let i = 0; i < idsArray.length; i += MAX_TOKENS) {
                    const chunkIds = idsArray.slice(i, i + MAX_TOKENS);

                    const model_inputs = {
                        input_ids: new Tensor('int64', new BigInt64Array(chunkIds.map(BigInt)), [chunkIds.length]),
                        offsets: new Tensor('int64', new BigInt64Array([BigInt(0)]), [1]),
                    };

                    const output = await model(model_inputs);
                    const embeddings = output['embeddings'];
                    if (!embeddings) throw new Error("Missing embeddings");

                    allVectors.push(Array.from(embeddings.data as ArrayLike<number>));
                    await yieldToEventLoop();
                }
            }

            return {
                tokenCount: totalTokenCount,
                vectors: allVectors
            };
        };
    }
}

// --- Message Handling ---
const ctx = self as unknown as Worker;

function isEmbedMessage(data: unknown): data is EmbedMessage {
    return (
        data !== null && typeof data === 'object' &&
        'type' in data && (data as { type: string }).type === 'embed'
    );
}

ctx.addEventListener('message', (event: MessageEvent) => {
    // Security: Verify message source if origin is available (Web Workers normally have empty origin)
    if (event.origin && event.origin !== 'null' && !self.location.origin.startsWith(event.origin)) return;
    void (async () => {
        const data = event.data as unknown;
        if (!data || typeof data !== 'object') return;

        if ('type' in data && (data as { type: string }).type === 'configure') {
            const config = data as ConfigureMessage;

            // Set dynamic CDN paths if provided
            if (config.cdnUrl && safeEnv.backends?.onnx?.wasm) {
                const baseUrl = config.cdnUrl.endsWith('/') ? config.cdnUrl : config.cdnUrl + '/';
                // Assign directly to base CDN URL instead of legacy specific WASM binary mapping objects
                safeEnv.backends.onnx.wasm.wasmPaths = baseUrl;
                logger.info("[Worker] CDN set to: " + baseUrl);
            }

            const wasm = safeEnv.backends?.onnx?.wasm;
            if (wasm && (wasm.numThreads !== config.numThreads || wasm.simd !== config.simd)) {
                logger.debug("[Worker] Configuration changed. Resetting pipeline instance.");
                if (activePipelineInstance && typeof activePipelineInstance.dispose === 'function') {
                    try {
                        await activePipelineInstance.dispose();
                    } catch (e) {
                        logger.error("[Worker] Failed to dispose previous pipeline instance on config change:", e);
                    }
                }
                activePipelineInstance = null;
                PipelineSingleton.instance = null;
            }

            if (wasm) {
                wasm.numThreads = config.numThreads;
                wasm.simd = config.simd;
                logger.debug("[Worker] Configured: threads=" + config.numThreads + ", simd=" + config.simd);
            }
            return;
        }

        if ('type' in data && (data as { type: string }).type === 'fetch_response') {
            // ... Fetch handling code ... 
            const response = data as unknown as { requestId: number, status: number, headers: Record<string, string>, body: ArrayBuffer, error?: string };
            const pending = pendingFetches.get(response.requestId);
            if (pending) {
                if (response.error) {
                    pending.reject(new Error(response.error));
                } else {
                    const resp = new Response(response.body, {
                        headers: response.headers,
                        status: response.status
                    });
                    pending.resolve(resp);
                }
                pendingFetches.delete(response.requestId);
            }
            return;
        }

        if (!isEmbedMessage(data)) return;

        const { id, model = 'Xenova/all-MiniLM-L6-v2', quantized = true, text } = data;

        try {
            const extractor = await PipelineSingleton.getInstance(model, quantized);
            const { tokenCount, vectors } = await extractor(text);

            logger.debug("[Worker] Generated " + vectors.length + " vectors (" + tokenCount + " tokens) for ID " + id);

            const response: WorkerSuccessResponse = {
                id,
                output: { tokenCount, vectors },
                status: 'success'
            };
            ctx.postMessage(response);

        } catch (err) {
            logger.error("[Worker] Error:", err);
            const response: WorkerErrorResponse = {
                error: err instanceof Error ? err.message : String(err),
                id,
                status: 'error'
            };
            ctx.postMessage(response);
        }
    })();
});

export default {} as unknown as new (options?: WorkerOptions) => Worker;
// Restore line count constraint