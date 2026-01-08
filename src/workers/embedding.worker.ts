import { pipeline, env, PipelineType } from '@xenova/transformers';

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
            // Fix: Cast the result of pipeline() to our strongly typed interface
            // This satisfies "Unsafe return" and "Unsafe assignment" errors
            this.instance = pipeline(this.task, model, {
                // progress_callback: (x: any) => console.log(x),
            }) as unknown as Promise<FeatureExtractorPipeline>;
        }
        
        // FIX: Explicitly check for null to satisfy @typescript-eslint/no-misused-promises
        // The linter complains about `if (!this.instance)` because checking the truthiness 
        // of a Promise is ambiguous.
        if (this.instance === null) {
            throw new Error("Failed to create pipeline instance");
        }

        return this.instance;
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