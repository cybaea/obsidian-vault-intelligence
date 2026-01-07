import { pipeline, env, PipelineType, FeatureExtractionPipeline } from '@huggingface/transformers';

// Configuration
env.allowLocalModels = false; 
env.useBrowserCache = true;

// --- Types ---

interface ProgressData {
    status: string;
    progress?: number;
    [key: string]: unknown;
}

interface EmbeddingRequest {
    id: number;
    type: 'embed';
    text: string;
}

interface WorkerResponse {
    id: number;
    status: 'success' | 'error';
    output?: number[];
    error?: string;
}

// --- Pipeline Singleton ---

class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance: Promise<FeatureExtractionPipeline> | null = null;

    static async getInstance(progressCallback?: (data: ProgressData) => void) {
        if (this.instance === null) {
            // FIX: Double cast (as unknown as ...) stops TypeScript from trying to 
            // compute the massive union type of all possible pipelines.
            this.instance = pipeline(this.task, this.model, {
                progress_callback: progressCallback
            }) as unknown as Promise<FeatureExtractionPipeline>;
        }
        return this.instance;
    }
}

// --- Worker Logic ---

// Safe context casting
const ctx = self as unknown as Worker;

// 1. Type Guard to validate incoming messages safely
function isEmbeddingRequest(data: unknown): data is EmbeddingRequest {
    return (
        typeof data === 'object' &&
        data !== null &&
        'id' in data &&
        'type' in data &&
        (data as EmbeddingRequest).type === 'embed'
    );
}

// 2. Event Listener (void return for async wrapper)
ctx.addEventListener('message', (event: MessageEvent) => {
    void (async () => {
        const data = event.data as unknown;

        if (!isEmbeddingRequest(data)) {
            // Ignore unknown messages
            return;
        }

        const { id, text } = data;

        try {
            // 3. Run Inference
            const extractor = await PipelineSingleton.getInstance((_data) => {
                // Optional: handle progress
            });

            const output = await extractor(text, { 
                pooling: 'mean', 
                normalize: true 
            });

            // 4. Safe Data Extraction
            // The output tensor data can be Float32Array or standard array. 
            // We ensure it is a number[] for postMessage compatibility.
            const vector = Array.from(output.data as Float32Array | number[]);

            const response: WorkerResponse = {
                id,
                status: 'success',
                output: vector
            };
            ctx.postMessage(response);

        } catch (err) {
            console.error("[Worker] Embedding Error:", err);
            
            const response: WorkerResponse = {
                id,
                status: 'error',
                error: err instanceof Error ? err.message : String(err)
            };
            ctx.postMessage(response);
        }
    })();
});

export {};
