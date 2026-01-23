export type EmbeddingPriority = 'high' | 'low';

export interface WorkerMessage {
    id: number;
    status: 'success' | 'error';
    output?: number[][];
    error?: string;
    type?: string;
    // For fetch proxy
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    requestId?: number;
    // For progress reporting
    file?: string;
    progress?: number;
}

export interface ProgressPayload {
    status: 'initiate' | 'downloading' | 'progress' | 'done' | 'ready';
    file?: string;
    progress?: number;
}

export interface ConfigureMessage {
    type: 'configure';
    numThreads: number;
    simd: boolean;
    cdnUrl?: string; // Optional in some contexts, strictly set in others
    version?: string;
}

export interface EmbedMessage {
    id: number;
    type: 'embed';
    text: string;
    model?: string;
    quantized?: boolean;
}

export interface WorkerSuccessResponse {
    id: number;
    status: 'success';
    output: number[][];
}

export interface WorkerErrorResponse {
    id: number;
    status: 'error';
    error: string;
}

export interface TransformersEnv {
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
