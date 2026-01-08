import { pipeline, env, PipelineType, AutoTokenizer, AutoModel, Tensor, PreTrainedModel } from '@xenova/transformers';

// --- 1. Strong Typing for Environment ---
interface TransformersEnv {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    useFS: boolean;
    backends?: {
        onnx?: {
            wasm?: {
                numThreads?: number;
                simd?: boolean;
                wasmPaths?: string | Record<string, string>;
                proxy?: boolean;
            }
        }
    }
}

// --- 2. Strong Typing for Pipeline ---
// We define the output shape to avoid 'any' errors on result.data
interface PipelineOutput {
    data: Float32Array | number[];
    dims: number[];
}

// Define the signature of the extractor function
interface FeatureExtractorPipeline {
    (text: string | string[], options?: Record<string, unknown>): Promise<PipelineOutput>;
}

// Cast env for safe configuration
const safeEnv = env as unknown as TransformersEnv;

// --- 3. Configure Environment ---
// Fix: "Unsafe member access .useFS" -> Now safe because of TransformersEnv
safeEnv.useFS = false;
safeEnv.allowLocalModels = false;
safeEnv.useBrowserCache = true;

// Initialize backends structure safely
if (!safeEnv.backends) {
    safeEnv.backends = {};
}
if (!safeEnv.backends.onnx) {
    safeEnv.backends.onnx = {};
}
if (!safeEnv.backends.onnx.wasm) {
    safeEnv.backends.onnx.wasm = {};
}

// Explicit CDN Paths
const CDN_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
safeEnv.backends.onnx.wasm.wasmPaths = {
    'ort-wasm.wasm': `${CDN_URL}ort-wasm.wasm`,
    'ort-wasm-simd.wasm': `${CDN_URL}ort-wasm-simd.wasm`,
    'ort-wasm-threaded.wasm': `${CDN_URL}ort-wasm-threaded.wasm`,
    'ort-wasm-simd-threaded.wasm': `${CDN_URL}ort-wasm-simd-threaded.wasm`,
};

safeEnv.backends.onnx.wasm.numThreads = 1;
safeEnv.backends.onnx.wasm.simd = false;
safeEnv.backends.onnx.wasm.proxy = false;

// --- Types ---
interface EmbedMessage {
    id: number;
    type: 'embed';
    text: string;
    model?: string;
}

interface WorkerSuccessResponse {
    id: number;
    status: 'success';
    output: number[];
}

interface WorkerErrorResponse {
    id: number;
    status: 'error';
    error: string;
}

// --- Pipeline Singleton ---
class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static instance: Promise<FeatureExtractorPipeline> | null = null;
    static currentModel: string = '';

    static async getInstance(model: string): Promise<FeatureExtractorPipeline> {
        if (this.currentModel && this.currentModel !== model) {
            this.instance = null;
        }

        if (this.instance === null) {
            this.currentModel = model;
            // Create a custom loader that handles retries for non-quantized models
            this.instance = this.loadPipeline(model);
        }

        return this.instance;
    }

    private static async loadPipeline(model: string): Promise<FeatureExtractorPipeline> {
        // SPECIAL CASE: Model2Vec models (like potion) require manual offsets in transformers.js currently
        if (model.includes('potion') || model.includes('model2vec')) {
            return this.loadModel2Vec(model);
        }

        try {
            // 1. Try default load (quantized: true by default)
            return await pipeline(this.task, model) as unknown as FeatureExtractorPipeline;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);

            // 2. If it fails because the quantized file is missing, retry with quantized: false
            if (errorMessage.includes("Could not locate file") || errorMessage.includes("404")) {
                console.warn(`[Worker] Quantized model not found for ${model}. Retrying with unquantized weights...`);
                try {
                    return await pipeline(this.task, model, {
                        quantized: false
                    }) as unknown as FeatureExtractorPipeline;
                } catch (retryErr) {
                    console.error(`[Worker] Failed to load unquantized model for ${model}:`, retryErr);
                    throw retryErr;
                }
            }

            throw err;
        }
    }

    /**
     * Specialized loader for Model2Vec models that require manual offset calculation.
     */
    private static async loadModel2Vec(modelName: string): Promise<FeatureExtractorPipeline> {
        console.debug(`[Worker] Loading Model2Vec specialized pipeline for: ${modelName}`);

        // We load tokenizer and model separately
        const tokenizer = await AutoTokenizer.from_pretrained(modelName);

        let model: PreTrainedModel;
        try {
            model = await AutoModel.from_pretrained(modelName);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes("Could not locate file") || errorMessage.includes("404")) {
                console.warn(`[Worker] Quantized model not found for ${modelName}. Retrying with unquantized weights...`);
                model = await AutoModel.from_pretrained(modelName, {
                    quantized: false
                });
            } else {
                throw err;
            }
        }

        // Return a function that implements the FeatureExtractorPipeline interface
        return (async (text: string | string[]) => {
            const texts = Array.isArray(text) ? text : [text];

            // Tokenize
            const { input_ids } = await tokenizer(texts, {
                add_special_tokens: false,
                return_tensor: false
            }) as { input_ids: number[][] };

            // Calculate offsets for Model2Vec
            // offsets = [0, ...cumsum(input_ids.slice(0, -1).map(x => x.length))]
            const offsets: number[] = [0];
            for (let i = 0; i < input_ids.length - 1; ++i) {
                const length = input_ids[i]?.length ?? 0;
                offsets.push(offsets[offsets.length - 1]! + length);
            }

            const flattened_input_ids = input_ids.flat();
            console.debug(`[Worker] Text length: ${texts.reduce((a, b) => a + b.length, 0)}, Tokens: ${flattened_input_ids.length}, Batches: ${input_ids.length}`);

            const model_inputs = {
                input_ids: new Tensor('int64', new BigInt64Array(flattened_input_ids.map(BigInt)), [flattened_input_ids.length]),
                offsets: new Tensor('int64', new BigInt64Array(offsets.map(BigInt)), [offsets.length]),
            };

            // Run model
            // Model2Vec models in transformers.js have 'embeddings' in output
            const output = await model(model_inputs) as Record<string, Tensor>;
            const embeddings = output['embeddings'];
            if (!embeddings) {
                throw new Error("Model2Vec output missing 'embeddings' tensor");
            }

            console.debug(`[Worker] Successfully generated Model2Vec embeddings. Dims: ${JSON.stringify(embeddings.dims)}`);

            return {
                data: Array.from(embeddings.data as Float32Array),
                dims: embeddings.dims
            } as PipelineOutput;
        }) as unknown as FeatureExtractorPipeline;
    }
}

// --- Message Handling ---
const ctx = self as unknown as Worker;

function isEmbedMessage(data: unknown): data is EmbedMessage {
    return (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data as { type: string }).type === 'embed'
    );
}

ctx.addEventListener('message', (event: MessageEvent) => {
    void (async () => {
        const data = event.data as unknown;

        if (!isEmbedMessage(data)) return;

        const { id, text, model = 'Xenova/all-MiniLM-L6-v2' } = data;

        try {
            // Extractor is now typed as FeatureExtractorPipeline
            const extractor = await PipelineSingleton.getInstance(model);

            // Output is now typed as PipelineOutput
            const output = await extractor(text, {
                pooling: 'mean',
                normalize: true
            });

            // output.data is known (Float32Array | number[]), so Array.from is safe
            const vector = Array.from(output.data);
            console.debug(`[Worker] Sending success response for ID ${id}. Vector length: ${vector.length}`);

            const response: WorkerSuccessResponse = {
                id,
                status: 'success',
                output: vector
            };
            ctx.postMessage(response);

        } catch (err) {
            console.error("[Worker] Error:", err);

            const response: WorkerErrorResponse = {
                id,
                status: 'error',
                error: err instanceof Error ? err.message : String(err)
            };
            ctx.postMessage(response);
        }
    })();
});
// --- Export for TypeScript ---
export default {} as unknown as new (options?: WorkerOptions) => Worker;
