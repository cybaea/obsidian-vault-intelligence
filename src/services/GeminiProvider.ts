import { Content, EmbedContentConfig, FunctionDeclaration, GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { App, Notice } from "obsidian";
import { z } from "zod";

import { MODEL_CONSTANTS, SEARCH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings";
import { ChatOptions, IEmbeddingClient, IModelProvider, IReasoningClient, IToolDefinition, ProviderError, ToolCall, UnifiedMessage } from "../types/providers";
import { logger } from "../utils/logger";

interface InternalSecretStorage {
    getSecret(key: string): string | null;
}

export interface EmbedOptions {
    outputDimensionality?: number;
    taskType?: string;
    title?: string;
}


export class GeminiProvider implements IModelProvider, IReasoningClient, IEmbeddingClient {
    private client: GoogleGenAI | null = null;
    private settings: VaultIntelligenceSettings;
    private app: App;

    // --- IModelProvider Capabilities ---
    public readonly supportsTools = true;
    public readonly supportsStructuredOutput = true;
    public readonly supportsWebGrounding = true;
    public readonly supportsCodeExecution = true;

    constructor(settings: VaultIntelligenceSettings, app: App) {
        this.settings = settings;
        this.app = app;
    }

    /**
     * Resolves the actual Google API key.
     * Handles SecretStorage ID lookup vs Legacy plain text fallback.
     */
    public async getApiKey(): Promise<string | null> {
        const storedValue = this.settings.googleApiKey;
        if (!storedValue) return null;

        if (this.settings.secretStorageFailure || storedValue.startsWith('AIza')) {
            return storedValue;
        }

        if (storedValue) {
            try {
                const storage = this.app.secretStorage as unknown as InternalSecretStorage | undefined;
                if (storage && storage.getSecret) {
                    return Promise.resolve(storage.getSecret(storedValue));
                }
                return null;
            } catch (error) {
                logger.error("Failed to retrieve secret from storage:", error);
                return null;
            }
        }
        return null;
    }

    private async getClient(): Promise<GoogleGenAI> {
        if (this.client) return this.client;

        const apiKey = await this.getApiKey();
        if (!apiKey) {
            if (this.settings.googleApiKey && !this.settings.googleApiKey.startsWith('AIza')) {
                new Notice("API key not found in this device's keychain. Please re-select it in settings.");
            }
            throw new ProviderError("Google API Key is missing or could not be retrieved.", "google");
        }

        try {
            this.client = new GoogleGenAI({ apiKey });
            logger.info("GeminiProvider initialized with resolved key.");
            return this.client;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ProviderError(`Failed to initialize Gemini client: ${message}`, "google");
        }
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.client = null; // Force re-initialization on next call
    }

    public isReady(): boolean {
        return !!this.client || (!!this.settings.googleApiKey && !this.settings.secretStorageFailure);
    }

    // --- IReasoningClient Implementation ---

    public async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        return this.retryOperation(async () => {
            const client = await this.getClient();
            const contents = this.formatHistory(messages);
            const tools = this.formatTools(options.tools);

            let systemInstruction = options.systemInstruction;
            
            // System instructions fallback
            // Extract the 'system' roles and map them to systemInstructions if not explicitly provided
            if (!systemInstruction) {
                const sysMsgs = messages.filter(m => m.role === 'system');
                if (sysMsgs.length > 0) {
                    systemInstruction = sysMsgs.map(m => m.content).join("\n");
                }
            }

            const response = await client.models.generateContent({
                config: {
                    systemInstruction: systemInstruction,
                    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
                },
                contents: contents,
                model: options.modelId || this.settings.chatModel
            });

            return this.parseResponse(response);
        });
    }

    public async generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T> {
        return this.retryOperation(async () => {
            const client = await this.getClient();
            const contents = this.formatHistory(messages);
            
            // Use explicit JSON schema from options if provided (Phase 1 stabilization)
            // fallback logic: options.jsonSchema -> existing _def hack (for future-proofing) -> tools parameters -> default 
            const responseSchema = options?.jsonSchema || 
                                 (schema as unknown as { _def: { jsonSchema?: Record<string, unknown> } })._def?.jsonSchema || 
                                 options?.tools?.[0]?.parameters || 
                                 { type: "object" };

            const response = await client.models.generateContent({
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema as Record<string, unknown>,
                    systemInstruction: options.systemInstruction
                },
                contents: contents,
                model: options.modelId || this.settings.chatModel
            });

            const text = response.text || "{}";
            try {
                return schema.parse(JSON.parse(text));
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                throw new ProviderError(`Failed to parse structured output: ${message}`, "google");
            }
        });
    }

    // --- Adapters Data Mapping ---

    private formatHistory(messages: UnifiedMessage[]): Content[] {
        const filtered = messages.filter(m => m.role !== 'system');
        if (filtered.length === 0) return [];

        const merged: Content[] = [];
        let currentRole: Content['role'] | null = null;
        let currentParts: Content['parts'] = [];

        for (const m of filtered) {
            const parts: Content['parts'] = [];
            
            if (m.content) {
                parts.push({ text: m.content });
            }

            if (m.toolCalls && m.toolCalls.length > 0) {
                if (m.role === 'model') {
                    m.toolCalls.forEach(call => {
                        parts.push({
                            functionCall: {
                                args: call.args,
                                name: call.name
                            }
                        });
                    });
                } else if (m.role === 'tool' && m.toolResults) {
                    m.toolResults.forEach(res => {
                        parts.push({
                            functionResponse: {
                                name: res.name,
                                response: res.result
                            }
                        });
                    });
                } else if (m.role === 'user' && m.name) {
                    // Legacy fallback (Phase 1 stabilization)
                    parts.push({
                        functionResponse: {
                            name: m.name,
                            response: (m.toolCalls?.[0]?.args as Record<string, unknown>) || undefined
                        }
                    });
                }
            }

            if (m.role === currentRole) {
                currentParts.push(...parts);
            } else {
                if (currentRole !== null) {
                    merged.push({ parts: currentParts, role: currentRole });
                }
                currentRole = m.role as Content['role'];
                currentParts = parts;
            }
        }

        if (currentRole !== null) {
            merged.push({ parts: currentParts, role: currentRole });
        }

        return merged;
    }

    private formatTools(tools?: IToolDefinition[]): FunctionDeclaration[] {
        if (!tools) return [];
        return tools.map(t => ({
            description: t.description,
            name: t.name,
            parameters: t.parameters as unknown as Record<string, unknown> // Note SDK Typing is strict, we typecast
        })) as FunctionDeclaration[];
    }

    private parseResponse(response: GenerateContentResponse): UnifiedMessage {
        const text = response.text || "";
        const toolCalls: ToolCall[] = [];

        if (response.functionCalls && response.functionCalls.length > 0) {
            response.functionCalls.forEach(call => {
                if (call.name) {
                    // Gemini correctly parses its own tool args
                    // We defensively enforce Record<string, unknown>
                    const safeArgs = (call.args && typeof call.args === 'object') ? call.args : {};
                    toolCalls.push({
                        args: safeArgs,
                        name: call.name
                    });
                }
            });
        }

        return {
            content: text,
            role: "model",
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }

    // --- Sub-Agent Legacy Adapters (Grounding) ---
    /**
     * Preserved specifically for backwards compat but wrapped correctly.
     * Web grounding goes out through here.
     */
    public async searchWithGrounding(query: string): Promise<{ text: string, tokenCount: number }> {
        return this.retryOperation(async () => {
             const client = await this.getClient();
             const response = await client.models.generateContent({
                 config: { tools: [{ googleSearch: {} }] },
                 contents: `Search for: "${query}". List key facts, dates, and details. Be concise.`,
                 model: this.settings.groundingModel
             });
             return {
                 text: response.text || "",
                 tokenCount: this.extractTokenCount(response, query)
             };
        });
    }

    public async solveWithCode(query: string): Promise<{ text: string, tokenCount: number }> {
        return this.retryOperation(async () => {
             const client = await this.getClient();
             const response = await client.models.generateContent({
                 config: { tools: [{ codeExecution: {} }] },
                 contents: query,
                 model: this.settings.codeModel
             });
             
             let resultString = "";
             const parts = response.candidates?.[0]?.content?.parts || [];
             for (const part of parts) {
                if (part.text) resultString += part.text + "\n";
                if (part.executableCode) resultString += `\n[Generated Code]\n\`\`\`python\n${part.executableCode.code}\n\`\`\`\n`;
                if (part.codeExecutionResult) resultString += `\n[Execution Result]\n${part.codeExecutionResult.output}\n`;
             }
             
             return {
                 text: resultString.trim() || "",
                 tokenCount: this.extractTokenCount(response, query)
             };
        });
    }

    // --- IEmbeddingClient Implementation ---

    public get modelName(): string {
        return this.settings.embeddingModel;
    }

    public get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    public async embedQuery(text: string): Promise<{ tokenCount: number; vector: number[] }> {
        const { tokenCount, values } = await this.embedText(text);
        return { tokenCount, vector: values };
    }

    public async embedDocument(text: string, title?: string): Promise<{ tokenCount: number; vectors: number[][] }> {
        const { tokenCount, values } = await this.embedText(text, { title });
        return { tokenCount, vectors: [values] };
    }

    private async embedText(text: string, options: EmbedOptions = {}): Promise<{ values: number[], tokenCount: number }> {
        return this.retryOperation(async () => {
            const client = await this.getClient();
            const config: EmbedContentConfig = {};
            
            config.outputDimensionality = options.outputDimensionality || this.settings.embeddingDimension;
            if (options.taskType) config.taskType = options.taskType;
            if (options.title) config.title = options.title;

            let modelId = this.settings.embeddingModel;
            if (modelId === 'embedding-001') modelId = MODEL_CONSTANTS.EMBEDDING_001;
            if (modelId === 'embedding-004') modelId = MODEL_CONSTANTS.TEXT_EMBEDDING_004;

            const result = await client.models.embedContent({
                config: config,
                contents: text,
                model: modelId
            });

            const embeddings = result.embeddings;
            if (!embeddings || embeddings.length === 0) {
                throw new ProviderError("No embeddings returned.", "google");
            }
            if (!embeddings[0] || !embeddings[0].values) {
                throw new ProviderError("No embedding values found.", "google");
            }
            
            return {
                tokenCount: this.extractTokenCount(result, text),
                values: embeddings[0].values
            };
        });
    }

    private extractTokenCount(response: unknown, fallbackText: string): number {
        const res = response as { usageMetadata?: { totalTokenCount?: number, promptTokenCount?: number }; embeddings?: { statistics?: { tokenCount?: number } }[] };
        const count = res.usageMetadata?.totalTokenCount || res.usageMetadata?.promptTokenCount || res.embeddings?.[0]?.statistics?.tokenCount;
        return (typeof count === 'number' && !isNaN(count) && count > 0)
             ? count
             : Math.ceil(fallbackText.length / SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE);
    }

    // --- Utility ---

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.settings.geminiRetries): Promise<T> {
        let lastError: Error | null = null;
        let delay = 1000;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error: unknown) {
                const err = error as { message?: string; status?: number };
                const isTransientError = err.message?.includes("429") || err.status === 429 || err.message?.includes("Failed to fetch");

                if (isTransientError) {
                    logger.warn(`Transient error (${err.message || "unknown"}). Retrying in ${Math.round(delay)}ms...`);
                    lastError = error instanceof Error ? error : new Error(String(error));
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                } else {
                    const message = err.message || "Unknown error occurred";
                    const status = err.status;
                    throw new ProviderError(message, "google", status);
                }
            }
        }
        throw lastError || new ProviderError("Max retries reached.", "google", 429);
    }
}
