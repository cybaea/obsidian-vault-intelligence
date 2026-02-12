export type EmbeddingPriority = 'high' | 'low';

export interface WorkerMessage {
    body?: string | ArrayBuffer;
    error?: string;
    // For progress reporting
    file?: string;
    headers?: Record<string, string>;
    id: number;
    method?: string;
    output?: { vectors: number[][], tokenCount: number };
    progress?: number;
    requestId?: number;
    status: 'success' | 'error';
    type?: string;
    // For fetch proxy
    url?: string;
}

export interface ProgressPayload {
    file?: string;
    progress?: number;
    status: 'initiate' | 'downloading' | 'progress' | 'done' | 'ready';
}

export interface ConfigureMessage {
    cdnUrl?: string; // Optional in some contexts, strictly set in others
    numThreads: number;
    simd: boolean;
    type: 'configure';
    version?: string;
}

export interface EmbedMessage {
    id: number;
    model?: string;
    quantized?: boolean;
    text: string;
    type: 'embed';
}

export interface WorkerSuccessResponse {
    id: number;
    output: { vectors: number[][], tokenCount: number };
    status: 'success';
}

export interface WorkerErrorResponse {
    error: string;
    id: number;
    status: 'error';
}

export interface TransformersEnv {
    allowLocalModels: boolean;
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
    useBrowserCache: boolean;
    useFS: boolean;
}
