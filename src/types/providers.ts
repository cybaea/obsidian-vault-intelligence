import { z } from "zod";

export type EmbeddingPriority = "high" | "low";

export interface ToolCall {
    args: Record<string, unknown>;
    id?: string;
    name: string;
    thought_signature?: string;
}

export interface ToolResult {
    id?: string;
    name: string;
    result: Record<string, unknown>;
    thought_signature?: string;
}

export interface UnifiedMessage {
    content: string;
    name?: string; // e.g., for function responses (legacy compat)
    /**
     * Optional raw content parts for perfect history preservation.
     * Used by providers like Gemini to maintain thought/metadata parts.
     */
    rawContent?: unknown[];
    role: "user" | "model" | "system" | "tool";
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface StreamChunk {
    createdFiles?: string[];
    files?: string[];
    isDone?: boolean;
    /**
     * Optional raw content parts for perfect history preservation.
     * Yielded when a turn or tool-loop step is complete.
     */
    rawContent?: unknown[];
    replaceText?: string;
    status?: string;
    text?: string;
    tokens?: number;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ChatOptions {
    contextWindowTokens?: number;
    /** Explicit JSON Schema for structured output fallback (Phase 1) */
    jsonSchema?: Record<string, unknown>;
    modelId?: string;
    signal?: AbortSignal;
    systemInstruction?: string;
    tools?: IToolDefinition[];
}

export interface IToolDefinition {
    description: string;
    name: string;
    parameters: {
        properties: Record<string, unknown>;
        required?: string[];
        type: "object";
    };
}

export interface IReasoningClient {
    generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage>;
    generateMessageStream(messages: UnifiedMessage[], options: ChatOptions): AsyncIterableIterator<StreamChunk>;
    generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T>;
    searchWithGrounding(query: string): Promise<{ text: string }>;
    solveWithCode(prompt: string): Promise<{ text: string }>;
}

export interface IEmbeddingClient {
    embedDocument(text: string, title?: string, priority?: EmbeddingPriority): Promise<{ tokenCount: number; vectors: number[][] }>;
    embedQuery(text: string, priority?: EmbeddingPriority): Promise<{ tokenCount: number; vector: number[] }>;
    updateConfiguration?(): void;
}

export interface IProvider {
    initialize?(): Promise<void>;
    terminate?(): Promise<void>;
}

export interface IReasoningCapabilities {
    /** Whether this provider supports internal code execution sandboxes */
    supportsCodeExecution: boolean;
    /** Whether this provider supports forced structured JSON-schema outputs natively */
    supportsStructuredOutput: boolean;
    /** Whether this provider supports sending and receiving tool calls natively */
    supportsTools: boolean;
    /** Whether this provider supports Google Search web grounding */
    supportsWebGrounding: boolean;
}

export interface IModelProvider extends IProvider, IReasoningCapabilities {}

export class ProviderError extends Error {
    public readonly provider: string;
    public readonly status?: number;
    
    constructor(message: string, provider: string, status?: number) {
        super(message);
        this.name = "ProviderError";
        this.provider = provider;
        this.status = status;
    }
}
