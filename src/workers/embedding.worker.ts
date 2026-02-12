import { pipeline, env, PipelineType, AutoTokenizer, AutoModel, Tensor, PreTrainedModel } from '@xenova/transformers';

import {
    TransformersEnv,
    ConfigureMessage,
    EmbedMessage,
    WorkerSuccessResponse,
    WorkerErrorResponse,
    ProgressPayload
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

// Initialized with dummy values, will be set via 'configure' message
safeEnv.backends.onnx.wasm.wasmPaths = {};

safeEnv.backends.onnx.wasm.numThreads = 1; // Default to safe single thread
safeEnv.backends.onnx.wasm.simd = true;
safeEnv.backends.onnx.wasm.proxy = false;

// --- 4. Fetch Proxy Implementation ---
const pendingFetches = new Map<number, { resolve: (resp: Response) => void, reject: (err: Error) => void }>();
let fetchRequestId = 0;

// Override global fetch to proxy through main thread (bypasses Obsidian CSP/CORS)
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();

    // Only proxy HuggingFace or remote calls. Local WASM paths should use original fetch (cached)
    if (!url.startsWith('http')) {
        return originalFetch(input, init);
    }

    return new Promise((resolve, reject) => {
        const requestId = fetchRequestId++;
        pendingFetches.set(requestId, { reject, resolve });

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

// --- Types ---
interface PipelineOutput {
    data: Float32Array | Int32Array | BigInt64Array;
}

type TokenIds = number[] | BigInt64Array | Tensor;

interface TokenizerOutput {
    attention_mask?: TokenIds;
    input_ids: TokenIds;
}

interface FeatureExtractorPipeline {
    (text: string | string[], options?: Record<string, unknown>): Promise<PipelineOutput>;
    tokenizer: {
        (text: string, options?: Record<string, unknown>): Promise<TokenizerOutput | TokenIds>;
        decode(tokens: TokenIds, options?: Record<string, unknown>): string;
    };
}

// Type for our unified extractor function
type ChunkedExtractor = (text: string) => Promise<{ vectors: number[][], tokenCount: number }>;

// --- 5. Global Error Handling ---
// Catch errors from sub-workers (like ONNX) or unhandled rejections
self.addEventListener('error', (e: ErrorEvent) => {
    let detail = 'Internal error';
    if (e.error) {
        if (e.error instanceof Error) {
            detail = `${e.error.name}: ${e.error.message}\n${e.error.stack}`;
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
            detail = `${e.reason.name}: ${e.reason.message}\n${e.reason.stack}`;
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
    return new Promise(resolve => setTimeout(resolve, 0));
}

// --- Pipeline Singleton ---
class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static instance: Promise<ChunkedExtractor> | null = null;
    static currentModel: string = '';
    static currentQuantized: boolean = true;

    static async getInstance(model: string, quantized: boolean = true): Promise<ChunkedExtractor> {
        if (this.currentModel && (this.currentModel !== model || this.currentQuantized !== quantized)) {
            logger.debug(`[Worker] Model/Config changed from ${this.currentModel}(q=${this.currentQuantized}) to ${model}(q=${quantized}). Resetting instance.`);
            this.instance = null;
        }

        if (this.instance === null) {
            logger.info(`[Worker] Initializing new pipeline for model: ${model} (quantized: ${quantized})`);
            this.currentModel = model;
            this.currentQuantized = quantized;

            // Define progress callback for model loading
            const progress_callback = (progress: ProgressPayload) => {
                if (progress.status === 'progress' || progress.status === 'initiate' || progress.status === 'downloading' || progress.status === 'done') {
                    ctx.postMessage({
                        file: progress.file || '',
                        progress: progress.progress || 0,
                        status: progress.status,
                        type: 'progress'
                    });
                }
            };

            this.instance = this.createChunkedExtractor(model, quantized, progress_callback);
        }

        return this.instance;
    }

    private static async createChunkedExtractor(modelName: string, quantized: boolean, progress_callback: (p: ProgressPayload) => void): Promise<ChunkedExtractor> {
        // SPECIAL CASE: Model2Vec
        if (modelName.includes('potion') || modelName.includes('model2vec')) {
            return this.loadModel2Vec(modelName, quantized, progress_callback);
        }

        // STANDARD CASE: Transformers.js Pipeline
        // 1. Try generic load
        let pipe: FeatureExtractorPipeline;
        try {
            pipe = await pipeline(this.task, modelName, { progress_callback, quantized }) as unknown as FeatureExtractorPipeline;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (quantized && msg.includes("404")) {
                logger.warn(`[Worker] Retrying unquantized for ${modelName}...`);
                pipe = await pipeline(this.task, modelName, { progress_callback, quantized: false }) as unknown as FeatureExtractorPipeline;
            } else {
                throw err;
            }
        }

        // Return wrapper that requires no manual chunking? 
        // Actually, pipeline() does NOT chunk automatically for feature-extraction. It truncates.
        // So we MUST implement chunking using pipe.tokenizer.

        return async (text: string) => {
            const tokenizer = pipe.tokenizer;
            const MAX_TOKENS = 512;
            const CHUNK_SIZE = MAX_TOKENS - 2;

            // --- Memory Safety: Character-level pre-segmentation ---
            const MAX_CHARS_PER_TOKENIZATION_BLOCK = 10000;
            const input_ids: number[] = [];

            for (let i = 0; i < text.length; i += MAX_CHARS_PER_TOKENIZATION_BLOCK) {
                const segment = text.slice(i, i + MAX_CHARS_PER_TOKENIZATION_BLOCK);
                try {
                    const result = await tokenizer(segment, { add_special_tokens: false });
                    const segmentIds = (result as TokenizerOutput).input_ids || (result as TokenIds);

                    let data: ArrayLike<number | bigint>;
                    if (segmentIds instanceof Tensor) {
                        data = segmentIds.data as ArrayLike<number | bigint>;
                    } else {
                        data = segmentIds as ArrayLike<number | bigint>;
                    }
                    input_ids.push(...Array.from(data).map(num => Number(num)));
                } catch (e) {
                    logger.error(`[Worker] Tokenization failed for segment ${i}-${i + MAX_CHARS_PER_TOKENIZATION_BLOCK}:`, e);
                    throw new Error(`Tokenization failed at character ${i}: ${e instanceof Error ? e.message : String(e)}`);
                }
                await yieldToEventLoop();
            }

            if (input_ids.length === 0) return { tokenCount: 0, vectors: [] };

            const vectors: number[][] = [];
            for (let i = 0; i < input_ids.length; i += CHUNK_SIZE) {
                const chunkIds = input_ids.slice(i, i + CHUNK_SIZE);
                try {
                    const chunkText = tokenizer.decode(chunkIds, {
                        clean_up_tokenization_spaces: true,
                        skip_special_tokens: true
                    });

                    if (!chunkText.trim()) continue;

                    const output = await pipe(chunkText, { normalize: true, pooling: 'mean' }) as unknown as PipelineOutput;
                    vectors.push(Array.from(output.data as ArrayLike<number>));
                } catch (e) {
                    logger.error(`[Worker] Inference failed for token chunk ${i}-${i + CHUNK_SIZE}:`, e);
                    throw new Error(`Inference failed at token ${i}: ${e instanceof Error ? e.message : String(e)}`);
                }
                await yieldToEventLoop();
            }

            return {
                tokenCount: input_ids.length,
                vectors: vectors
            };
        };
    }

    private static async loadModel2Vec(modelName: string, quantized: boolean, progress_callback: (p: ProgressPayload) => void): Promise<ChunkedExtractor> {
        // ... (Model2Vec logic same as before, elided for brevity if unchanged logic, but keeping full for safety)
        logger.debug(`[Worker] Loading Model2Vec: ${modelName} (quantized=${quantized})`);
        const tokenizer = await AutoTokenizer.from_pretrained(modelName, { progress_callback });
        let model: PreTrainedModel;

        try {
            model = await AutoModel.from_pretrained(modelName, { progress_callback, quantized });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (quantized) {
                logger.warn(`[Worker] Failed to load model (quantized): ${msg}. Retrying unquantized...`);
                model = await AutoModel.from_pretrained(modelName, { progress_callback, quantized: false });
            } else {
                throw err;
            }
        }

        return async (text: string) => {
            const MAX_TOKENS = 512;
            const MAX_CHARS_PER_TOKENIZATION_BLOCK = 10000;
            const input_ids: number[] = [];

            for (let i = 0; i < text.length; i += MAX_CHARS_PER_TOKENIZATION_BLOCK) {
                const segment = text.slice(i, i + MAX_CHARS_PER_TOKENIZATION_BLOCK);
                const { input_ids: segmentIds } = await tokenizer(segment, { add_special_tokens: false, return_tensor: false }) as { input_ids: number[] | BigInt64Array };
                input_ids.push(...Array.from(segmentIds as ArrayLike<number | bigint>).map(num => Number(num)));
                await yieldToEventLoop();
            }

            if (input_ids.length === 0) return { tokenCount: 0, vectors: [] };

            const vectors: number[][] = [];
            const idsArray = input_ids;

            for (let i = 0; i < idsArray.length; i += MAX_TOKENS) {
                const chunkIds = idsArray.slice(i, i + MAX_TOKENS);

                const model_inputs = {
                    input_ids: new Tensor('int64', new BigInt64Array(chunkIds.map(BigInt)), [chunkIds.length]),
                    offsets: new Tensor('int64', new BigInt64Array([BigInt(0)]), [1]),
                };

                const output = await model(model_inputs) as Record<string, Tensor>;
                const embeddings = output['embeddings'];
                if (!embeddings) throw new Error("Missing embeddings");

                vectors.push(Array.from(embeddings.data as ArrayLike<number>));
                await yieldToEventLoop();
            }

            return {
                tokenCount: input_ids.length,
                vectors: vectors
            };
        };
    }
}

// --- Message Handling ---
const ctx = self as unknown as Worker;

function isEmbedMessage(data: unknown): data is EmbedMessage {
    return (
        typeof data === 'object' && data !== null &&
        'type' in data && (data as { type: string }).type === 'embed'
    );
}

ctx.addEventListener('message', (event: MessageEvent) => {
    void (async () => {
        const data = event.data as unknown;
        if (!data || typeof data !== 'object') return;

        if ('type' in data && (data as { type: string }).type === 'configure') {
            const config = data as ConfigureMessage;

            // Set dynamic CDN paths if provided
            if (config.cdnUrl && safeEnv.backends?.onnx?.wasm) {
                const baseUrl = config.cdnUrl.endsWith('/') ? config.cdnUrl : `${config.cdnUrl}/`;
                safeEnv.backends.onnx.wasm.wasmPaths = {
                    'ort-wasm-simd-threaded.wasm': `${baseUrl}ort-wasm-simd-threaded.wasm`,
                    'ort-wasm-simd.wasm': `${baseUrl}ort-wasm-simd.wasm`,
                    'ort-wasm-threaded.wasm': `${baseUrl}ort-wasm-threaded.wasm`,
                    'ort-wasm.wasm': `${baseUrl}ort-wasm.wasm`,
                };
                logger.info(`[Worker] CDN set to: ${baseUrl}`);
            }

            const wasm = safeEnv.backends?.onnx?.wasm;
            if (wasm && (wasm.numThreads !== config.numThreads || wasm.simd !== config.simd)) {
                logger.debug(`[Worker] Configuration changed. Resetting pipeline instance.`);
                PipelineSingleton.instance = null;
            }

            if (wasm) {
                wasm.numThreads = config.numThreads;
                wasm.simd = config.simd;
                logger.debug(`[Worker] Configured: threads=${config.numThreads}, simd=${config.simd}`);
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

            logger.debug(`[Worker] Generated ${vectors.length} vectors (${tokenCount} tokens) for ID ${id}`);

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
