import { pipeline, env, PipelineType, FeatureExtractionPipeline } from '@xenova/transformers';

// --- Environment Typing ---
interface TransformersEnv {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    useFS: boolean; // CRITICAL: This was missing
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

// 1. FORCE BROWSER MODE (The Fix)
// Electron has 'fs' (file system) access, which confuses the library.
// We must disable it so the library uses the WASM backend instead of trying native Node bindings.
safeEnv.useFS = false; 
safeEnv.allowLocalModels = false;
safeEnv.useBrowserCache = true;

// 2. Configure Backend
if (!safeEnv.backends) safeEnv.backends = {};
if (!safeEnv.backends.onnx) safeEnv.backends.onnx = {};
if (!safeEnv.backends.onnx.wasm) safeEnv.backends.onnx.wasm = {};

// 3. Explicit CDN Paths
// We define the specific files to ensure no relative path resolution is attempted.
const CDN_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
safeEnv.backends.onnx.wasm.wasmPaths = {
    'ort-wasm.wasm': `${CDN_URL}ort-wasm.wasm`,
    'ort-wasm-simd.wasm': `${CDN_URL}ort-wasm-simd.wasm`,
    'ort-wasm-threaded.wasm': `${CDN_URL}ort-wasm-threaded.wasm`,
    'ort-wasm-simd-threaded.wasm': `${CDN_URL}ort-wasm-simd-threaded.wasm`,
};

// 4. Compatibility Settings
safeEnv.backends.onnx.wasm.numThreads = 1; // Prevent thread contention
safeEnv.backends.onnx.wasm.simd = false;   // Disable SIMD to ensure broad hardware compatibility
safeEnv.backends.onnx.wasm.proxy = false;  // Disable proxying inside the inline worker

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
    static instance: Promise<FeatureExtractionPipeline> | null = null;
    static currentModel: string = '';

    static async getInstance(model: string) {
        if (this.currentModel && this.currentModel !== model) {
            this.instance = null;
        }

        if (this.instance === null) {
            this.currentModel = model;
            this.instance = pipeline(this.task, model, {
                // Optional: Progress callback could be added here
            }) as Promise<FeatureExtractionPipeline>;
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

ctx.addEventListener('message', (event) => {
    void (async () => {
        const data = event.data as unknown;
        
        if (!isEmbedMessage(data)) return;

        const { id, text, model = 'Xenova/all-MiniLM-L6-v2' } = data;

        try {
            const extractor = await PipelineSingleton.getInstance(model);
            
            const output = await extractor(text, { 
                pooling: 'mean', 
                normalize: true 
            });

            const vector = Array.from(output.data as Float32Array);

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