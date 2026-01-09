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

// Explicit CDN Paths
const CDN_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
safeEnv.backends.onnx.wasm.wasmPaths = {
    'ort-wasm.wasm': `${CDN_URL}ort-wasm.wasm`,
    'ort-wasm-simd.wasm': `${CDN_URL}ort-wasm-simd.wasm`,
    'ort-wasm-threaded.wasm': `${CDN_URL}ort-wasm-threaded.wasm`,
    'ort-wasm-simd-threaded.wasm': `${CDN_URL}ort-wasm-simd-threaded.wasm`,
};

safeEnv.backends.onnx.wasm.numThreads = 1; // Default to safe single thread
safeEnv.backends.onnx.wasm.simd = true;
safeEnv.backends.onnx.wasm.proxy = false;

// --- Types ---
interface ConfigureMessage {
    type: 'configure';
    numThreads: number;
    simd: boolean;
}

interface EmbedMessage {
    id: number;
    type: 'embed';
    text: string;
    model?: string;
}

interface PipelineOutput {
    data: Float32Array | Int32Array | BigInt64Array;
}

interface WorkerSuccessResponse {
    id: number;
    status: 'success';
    output: number[][]; // Changed to Array of Vectors
}

interface WorkerErrorResponse {
    id: number;
    status: 'error';
    error: string;
}

// Define a more complete interface for the pipeline
interface FeatureExtractorPipeline {
    (text: string | string[], options?: Record<string, unknown>): Promise<PipelineOutput>;
    tokenizer: {
        (text: string): Promise<{ input_ids: number[] | BigInt64Array }>;
        decode(tokens: number[] | BigInt64Array | Tensor, options?: Record<string, unknown>): string;
    };
}

// Type for our unified extractor function
type ChunkedExtractor = (text: string) => Promise<number[][]>;

// --- Pipeline Singleton ---
class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static instance: Promise<ChunkedExtractor> | null = null;
    static currentModel: string = '';

    static async getInstance(model: string): Promise<ChunkedExtractor> {
        if (this.currentModel && this.currentModel !== model) {
            this.instance = null;
        }

        if (this.instance === null) {
            this.currentModel = model;
            this.instance = this.createChunkedExtractor(model);
        }

        return this.instance;
    }

    private static async createChunkedExtractor(modelName: string): Promise<ChunkedExtractor> {
        // SPECIAL CASE: Model2Vec
        if (modelName.includes('potion') || modelName.includes('model2vec')) {
            return this.loadModel2Vec(modelName);
        }

        // STANDARD CASE: Transformers.js Pipeline
        // 1. Try generic load
        let pipe: FeatureExtractorPipeline;
        try {
            pipe = await pipeline(this.task, modelName) as unknown as FeatureExtractorPipeline;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("404")) {
                console.warn(`[Worker] Retrying unquantized for ${modelName}...`);
                pipe = await pipeline(this.task, modelName, { quantized: false }) as unknown as FeatureExtractorPipeline;
            } else {
                throw err;
            }
        }

        // Return wrapper that requires no manual chunking? 
        // Actually, pipeline() does NOT chunk automatically for feature-extraction. It truncates.
        // So we MUST implement chunking using pipe.tokenizer.

        return async (text: string) => {
            const tokenizer = pipe.tokenizer;
            // 512 is standard, but some models vary. Safe default is 512.
            const MAX_TOKENS = 512;
            // CLS + SEP = 2 tokens overhead usually
            const CHUNK_SIZE = MAX_TOKENS - 2;

            const { input_ids: rawIds } = await tokenizer(text);
            // TS2769: BigInt64Array is not directly assignable to Iterable<number>.
            const input_ids = Array.from(rawIds as ArrayLike<number | bigint>).map(num => Number(num));

            // If short enough, just run
            if (input_ids.length <= CHUNK_SIZE) {
                const output = await pipe(text, { pooling: 'mean', normalize: true }) as unknown as PipelineOutput;
                // output.data can be various typed arrays. Array.from handles generic ArrayLike.
                return [Array.from(output.data as ArrayLike<number>)];
            }

            // Chunking Loop
            const vectors: number[][] = [];
            for (let i = 0; i < input_ids.length; i += CHUNK_SIZE) {
                const chunkIds = input_ids.slice(i, i + CHUNK_SIZE);
                // Decode back to string to pass to pipeline
                // This is compatible with all models
                const chunkText = tokenizer.decode(chunkIds, { skip_special_tokens: true });

                // Skip empty chunks
                if (!chunkText.trim()) continue;

                const output = await pipe(chunkText, { pooling: 'mean', normalize: true }) as unknown as PipelineOutput;
                vectors.push(Array.from(output.data as ArrayLike<number>));
            }

            return vectors;
        };
    }

    private static async loadModel2Vec(modelName: string): Promise<ChunkedExtractor> {
        console.debug(`[Worker] Loading Model2Vec: ${modelName}`);
        const tokenizer = await AutoTokenizer.from_pretrained(modelName);
        let model: PreTrainedModel;

        try {
            model = await AutoModel.from_pretrained(modelName);
        } catch {
            console.warn(`[Worker] Retrying unquantized...`);
            model = await AutoModel.from_pretrained(modelName, { quantized: false });
        }

        return async (text: string) => {
            const { input_ids: rawIds } = await tokenizer(text, { add_special_tokens: false, return_tensor: false }) as { input_ids: number[] | BigInt64Array };
            const input_ids = Array.from(rawIds as ArrayLike<number | bigint>).map(num => Number(num));

            const MAX_TOKENS = 512;
            // Model2Vec might not need CLS/SEP in the same way, but let's stick to 512 limit

            const vectors: number[][] = [];
            const idsArray = input_ids; // number[]

            // If empty
            if (idsArray.length === 0) return [];

            // Chunk loop
            for (let i = 0; i < idsArray.length; i += MAX_TOKENS) {
                const chunkIds = idsArray.slice(i, i + MAX_TOKENS);

                // Prepare Manually for Model2Vec
                // offsets = [0, length_of_token1, ...] -> wait, Model2Vec offsets are cumulative? 
                // Previous code: offsets = [0, ...cumsum(lengths)]
                // But wait, input_ids are TOKENS. Each token has length? 
                // Ah, "Model2Vec models... require manual offsets".
                // In my previous working code: 
                //   offsets.push(offsets[last] + input_ids[i].length)??
                // Wait, input_ids[i] is a number (Token ID). It doesn't have .length.
                // The previous code had: `input_ids` as `number[][]` (batches?).
                // "const { input_ids } = await tokenizer(texts, ...) as { input_ids: number[][] };"
                // The previous code handled batch of strings. Here we have one string (chunk).
                // But wait, Model2Vec tokenizer output: if I pass string, I get ids.
                // The "offsets" logic in previous code iterated over `input_ids` as if it was `number[][]`.
                // Ah, previous code: `texts` was array. `input_ids` was array of arrays.

                // For a SINGLE string chunk:
                // We treat it as one "document".
                // offsets for 1 doc is just [0, end]? No.
                // Model2Vec "offsets" input usually maps to "words". 
                // Let's look at the previous working code again carefully.
                // "input_ids" from tokenizer(texts) -> number[][] (batch x seq_len)
                // The manual offset loop:
                // for (let i = 0; i < input_ids.length - 1; ++i) { ... }
                // This loops over the BATCH.
                // Implementation: We create 1 Input ID array (flattened) and 1 Offset array (batch boundaries).

                // So for a single chunk, input_ids is [id1, id2...]. 
                // Flattened = [id1, id2...].
                // Offsets = [0, length].
                // So `offsets` = `[0, chunkIds.length]`.

                const flattened_input_ids = chunkIds;

                // Current transformers.js might expect offsets to be just [0] if only 1 sequence?
                // Or [0, len].
                // Let's assume [0, len] to define the range.
                // Wait, `offsets` tensor usually defines the START of each sequence.
                // So for 1 sequence, it's just `[0]`.
                // The previous code had `offsets.push(...)`.
                // `offsets = [0]`. Loop over `input_ids.length - 1`.
                // If `input_ids` (batch) has 1 item, loop doesn't run. `offsets` remains `[0]`.
                // Correct.

                const model_inputs = {
                    input_ids: new Tensor('int64', new BigInt64Array(flattened_input_ids.map(BigInt)), [flattened_input_ids.length]),
                    offsets: new Tensor('int64', new BigInt64Array([BigInt(0)]), [1]),
                };

                const output = await model(model_inputs) as Record<string, Tensor>;
                const embeddings = output['embeddings'];
                if (!embeddings) throw new Error("Missing embeddings");

                // Safely cast to ArrayLike<number> for conversion
                vectors.push(Array.from(embeddings.data as ArrayLike<number>));
            }

            return vectors;
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
            safeEnv.backends!.onnx!.wasm!.numThreads = config.numThreads;
            safeEnv.backends!.onnx!.wasm!.simd = config.simd;
            console.debug(`[Worker] Configured: threads=${config.numThreads}, simd=${config.simd}`);
            return;
        }

        if (!isEmbedMessage(data)) return;

        const { id, text, model = 'Xenova/all-MiniLM-L6-v2' } = data;

        try {
            const extractor = await PipelineSingleton.getInstance(model);
            const vectors = await extractor(text);

            console.debug(`[Worker] Generated ${vectors.length} vectors for ID ${id}`);

            const response: WorkerSuccessResponse = {
                id,
                status: 'success',
                output: vectors
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

export default {} as unknown as new (options?: WorkerOptions) => Worker;
