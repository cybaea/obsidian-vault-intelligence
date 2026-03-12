import { z } from "zod";

export type EmbeddingPriority = "high" | "low";

export interface ToolCall {
    args: Record<string, unknown>;
    id?: string;
    name: string;
}

export interface ToolResult {
    id?: string;
    name: string;
    result: Record<string, unknown>;
}

export interface UnifiedMessage {
    content: string;
    name?: string; // e.g., for function responses (legacy compat)
    role: "user" | "model" | "system" | "tool";
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ChatOptions {
    contextWindowTokens?: number;
    /** Explicit JSON Schema for structured output fallback (Phase 1) */
    jsonSchema?: Record<string, unknown>;
    modelId?: string;
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
