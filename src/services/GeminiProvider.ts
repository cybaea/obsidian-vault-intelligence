import { Content, EmbedContentConfig, FunctionDeclaration, GenerateContentParameters, GenerateContentResponse, GoogleGenAI, Part } from "@google/genai";
import { App, Notice } from "obsidian";
import { z } from "zod";

import { MODEL_CONSTANTS, SEARCH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings";
import { ChatOptions, IEmbeddingClient, IModelProvider, IReasoningClient, IToolDefinition, ProviderError, StreamChunk, ToolCall, UnifiedMessage } from "../types/providers";
import { logger } from "../utils/logger";
import { getGoogleApiKeySecretName, hasGoogleApiKey } from "../utils/secrets";
import { ModelRegistry } from "./ModelRegistry";

interface InternalSecretStorage {
    getSecret(key: string): string | null;
}

export interface EmbedOptions {
    outputDimensionality?: number;
    taskType?: string;
    title?: string;
}

/** Interface for Phase 8 SDK unification fix */
interface UnifiedSDKParams extends GenerateContentParameters {
    system_instruction?: unknown;
    systemInstruction?: unknown;
    tools?: unknown;
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
        const rawKey = this.settings.googleApiKey?.trim();
        const secretKey = getGoogleApiKeySecretName(this.settings);

        if (!rawKey && !secretKey) return null;

        if (this.settings.secretStorageFailure || (rawKey && rawKey.startsWith('AIza'))) {
            return rawKey || null;
        }

        if (secretKey) {
            try {
                const storage = this.app.secretStorage as unknown as InternalSecretStorage | undefined;
                if (storage && storage.getSecret) {
                    return Promise.resolve(storage.getSecret(secretKey));
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
            if (getGoogleApiKeySecretName(this.settings)) {
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
        return !!this.client || (hasGoogleApiKey(this.settings) && !this.settings.secretStorageFailure);
    }

    // --- IReasoningClient Implementation ---

    public async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        return this.retryOperation(async () => {
            const client = await this.getClient();
            const contents = this.formatHistory(messages);

            const isWebSearchEnabled = options.enableWebSearch !== undefined ? options.enableWebSearch : this.settings.enableWebSearch;
            const isUrlContextEnabled = options.enableUrlContext !== undefined ? options.enableUrlContext : this.settings.enableUrlContext;

            const modelDef = options.modelId ? ModelRegistry.getModelById(options.modelId) : undefined;
            const useNativeSearch = isWebSearchEnabled && modelDef?.supportsNativeSearch;
            const useUrlContext = isUrlContextEnabled && modelDef?.supportsUrlContext;

            let systemInstruction = options.systemInstruction;
            
            // System instructions fallback
            // Extract the 'system' roles and map them to systemInstructions if not explicitly provided
            if (!systemInstruction) {
                const sysMsgs = messages.filter(m => m.role === 'system');
                if (sysMsgs.length > 0) {
                    systemInstruction = sysMsgs.map(m => m.content).join("\n");
                }
            }

            let activeTools = options.tools || [];
            if (useNativeSearch) {
                activeTools = activeTools.filter(t => t.name !== 'google_search');
            }
            if (useUrlContext) {
                activeTools = activeTools.filter(t => t.name !== 'read_url');
                if (systemInstruction) {
                    systemInstruction = systemInstruction.replace(/\s*-\s*Use\s*'?read_url'?[^\n]*?(?=\n)/gi, "");
                }
            }

            const tools = this.formatTools(activeTools);

            // Phase 8 SDK unification fix: Move tools and systemInstruction to top-level as well as config
            const requestParams: UnifiedSDKParams = {
                config: {},
                contents: contents,
                model: options.modelId || this.settings.chatModel
            };

            const toolObjects = [] as import('@google/genai').Tool[];
            if (tools && tools.length > 0) {
                toolObjects.push({ functionDeclarations: tools });
            }
            if (useNativeSearch) {
                toolObjects.push({ googleSearch: {} });
            }
            if (useUrlContext) {
                toolObjects.push({ urlContext: {} } as import('@google/genai').Tool);
            }

            if (toolObjects.length > 0) {
                requestParams.tools = toolObjects;
                if (requestParams.config) {
                    requestParams.config.tools = toolObjects;
                    // Fix 'INVALID_ARGUMENT' 400 error when using built-in Google tools (like search)
                    // alongside client-side tools (like function calling/MCP).
                    requestParams.config.toolConfig = { include_server_side_tool_invocations: true, includeServerSideToolInvocations: true } as unknown as import('@google/genai').ToolConfig;
                }
            }

            if (systemInstruction) {
                if (requestParams.config) {
                    requestParams.config.systemInstruction = systemInstruction;
                }
            }

            logger.debug("[Agent] Final Request Params", requestParams);

            const response = await client.models.generateContent(requestParams);
            const parsed = this.parseResponse(response);

            const candidate = response.candidates?.[0];
            interface ICandidateWithGrounding {
                groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] };
            }
            const groundingChunks = (candidate as unknown as ICandidateWithGrounding)?.groundingMetadata?.groundingChunks || [];
            const citations: string[] = [];
            for (const gc of groundingChunks) {
                if (gc.web?.uri && gc.web?.title) {
                    const citation = `[${gc.web.title}](${gc.web.uri})`;
                    if (!citations.includes(citation)) citations.push(citation);
                }
            }
            if (citations.length > 0 && parsed.content) {
                 const formattedCitations = "\n\n---\n**Sources:**\n" + citations.map((c, i) => `[${i + 1}] ${c}`).join("\n");
                 parsed.content = parsed.content.trimEnd() + formattedCitations;
            }

            return parsed;
        });
    }

    public async *generateMessageStream(messages: UnifiedMessage[], options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const client = await this.getClient();
        const contents = this.formatHistory(messages);

        const isWebSearchEnabled = options.enableWebSearch !== undefined ? options.enableWebSearch : this.settings.enableWebSearch;
        const isUrlContextEnabled = options.enableUrlContext !== undefined ? options.enableUrlContext : this.settings.enableUrlContext;

        const modelDef = options.modelId ? ModelRegistry.getModelById(options.modelId) : undefined;
        const useNativeSearch = isWebSearchEnabled && modelDef?.supportsNativeSearch;
        const useUrlContext = isUrlContextEnabled && modelDef?.supportsUrlContext;

        let systemInstruction = options.systemInstruction;
        if (!systemInstruction) {
            const sysMsgs = messages.filter(m => m.role === 'system');
            if (sysMsgs.length > 0) {
                systemInstruction = sysMsgs.map(m => m.content).join("\n");
            }
        }

        // Phase 8 SDK unification fix: Move tools and systemInstruction to top-level as well as config
        let activeTools = options.tools || [];
        if (useNativeSearch) {
            activeTools = activeTools.filter(t => t.name !== 'google_search');
        }
        if (useUrlContext) {
            activeTools = activeTools.filter(t => t.name !== 'read_url');
            if (systemInstruction) {
                systemInstruction = systemInstruction.replace(/\s*-\s*Use\s*'?read_url'?[^\n]*?(?=\n)/gi, "");
            }
        }

        const tools = this.formatTools(activeTools);

        const requestParams: UnifiedSDKParams = {
            config: {},
            contents: contents,
            model: options.modelId || this.settings.chatModel
        };
        const toolObjects = [] as import('@google/genai').Tool[];
        if (tools && tools.length > 0) {
            toolObjects.push({ functionDeclarations: tools });
        }
        if (useNativeSearch) {
            toolObjects.push({ googleSearch: {} });
        }
        if (useUrlContext) {
            toolObjects.push({ urlContext: {} } as import('@google/genai').Tool);
        }

        if (toolObjects.length > 0) {
            requestParams.tools = toolObjects;
            if (requestParams.config) {
                requestParams.config.tools = toolObjects;
                // Fix 'INVALID_ARGUMENT' 400 error when using built-in Google tools (like search)
                // alongside client-side tools (like function calling/MCP).
                requestParams.config.toolConfig = { include_server_side_tool_invocations: true, includeServerSideToolInvocations: true } as unknown as import('@google/genai').ToolConfig;
            }
        }

        if (systemInstruction) {
            if (requestParams.config) {
                requestParams.config.systemInstruction = systemInstruction;
            }
        }

        logger.debug("[Agent] Final Request Params", requestParams);

        const streamResponse = await client.models.generateContentStream(requestParams);

        const accumulatedParts: Part[] = [];
        let activeThoughtSignature: string | undefined;
        const citations: string[] = [];
        let fullText = "";

        try {
            for await (const chunk of streamResponse) {
                if (options.signal?.aborted) {
                    break;
                }

                const candidate = chunk.candidates?.[0];
                interface ICandidateWithGrounding {
                    groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] };
                }
                const groundingChunks = (candidate as unknown as ICandidateWithGrounding)?.groundingMetadata?.groundingChunks || [];
                for (const gc of groundingChunks) {
                    if (gc.web?.uri && gc.web?.title) {
                        const citation = `[${gc.web.title}](${gc.web.uri})`;
                        if (!citations.includes(citation)) citations.push(citation);
                    }
                }

                if (candidate?.content?.parts) {
                    accumulatedParts.push(...candidate.content.parts);
                    
                    // Capture thought_signature if present in this chunk
                    candidate.content.parts.forEach(part => {
                        const partObj = part as Record<string, unknown>;
                        if (typeof partObj['thought_signature'] === 'string') {
                            activeThoughtSignature = partObj['thought_signature'];
                        }
                    });
                }

                const parsed = this.parseResponse(chunk);
                if (parsed.content) {
                    fullText += parsed.content;
                    yield { text: parsed.content };
                }
            }

            if (!options.signal?.aborted) {
                if (citations.length > 0) {
                    const formattedCitations = "\n\n---\n**Sources:**\n" + citations.map((c, i) => `[${i + 1}] ${c}`).join("\n");
                    yield { replaceText: fullText.trimEnd() + formattedCitations };
                }

                if (accumulatedParts.length > 0) {
                // Yield the fully aggregated tool calls once at the end.
                // Re-parsing all parts ensures complete functionCall arguments.
                const finalParsed = this.parseResponse({
                    candidates: [{
                        content: { parts: accumulatedParts }
                    }]
                } as unknown as GenerateContentResponse);

                if (finalParsed.toolCalls && activeThoughtSignature) {
                    finalParsed.toolCalls.forEach(call => {
                        if (!call.thought_signature) {
                            call.thought_signature = activeThoughtSignature;
                        }
                    });
                }

                yield {
                    isDone: true,
                    rawContent: accumulatedParts,
                    toolCalls: finalParsed.toolCalls
                };
            }
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("429")) {
                throw new ProviderError("Rate limit exceeded during streaming", "google", 429);
            }
            throw new ProviderError(`Streaming error: ${message}`, "google");
        }
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

            // Phase 8 SDK unification fix: Move systemInstruction to top-level as well as config
            const requestParams: UnifiedSDKParams = {
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema as Record<string, unknown>
                },
                contents: contents,
                model: options.modelId || this.settings.chatModel
            };

            if (options.systemInstruction) {
                if (requestParams.config) {
                    requestParams.config.systemInstruction = options.systemInstruction;
                }
            }

            logger.debug("[Agent] Final Request Params (Structured)", requestParams);

            const response = await client.models.generateContent(requestParams);

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
            let parts: Part[] = [];

            if (m.rawContent && m.rawContent.length > 0) {
                parts = [...(m.rawContent as Part[])];
            } else {
                if (m.content) {
                    parts.push({ text: m.content });
                }

                if (m.role === 'model' && m.toolCalls && m.toolCalls.length > 0) {
                    m.toolCalls.forEach((call) => {
                        const fc: Part['functionCall'] = {
                            args: call.args,
                            name: call.name
                        };
                        const part: Record<string, unknown> = { functionCall: fc };
                        // Sibling placement: thought_signature belongs on the Part object, not inside functionCall
                        if (call.thought_signature) {
                            part['thought_signature'] = call.thought_signature;
                        }
                        parts.push(part as unknown as Part);
                    });
                } else if (m.role === 'tool' && m.toolResults && m.toolResults.length > 0) {
                    m.toolResults.forEach(res => {
                        const fr: Part['functionResponse'] = {
                            name: res.name,
                            response: res.result
                        };
                        parts.push({ functionResponse: fr as unknown as Part['functionResponse'] } as Part);
                    });
                } else if (m.role === 'user' && m.name && m.toolCalls && m.toolCalls.length > 0) {
                    // Legacy fallback (Phase 1 stabilization)
                    parts.push({
                        functionResponse: {
                            name: m.name,
                            response: (m.toolCalls?.[0]?.args as Record<string, unknown>) || undefined
                        }
                    });
                }
            }

            const mappedRole: Content['role'] = (m.role === 'tool' || m.role === 'user') ? 'user' : 'model';

            if (mappedRole === currentRole) {
                currentParts.push(...parts);
            } else {
                if (currentRole !== null && currentParts.length > 0) {
                    merged.push({ parts: currentParts, role: currentRole });
                }
                currentRole = mappedRole;
                currentParts = [...parts];
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
        const candidate = response.candidates?.[0];
        // Safely extract text from parts to avoid SDK property/getter confusion
        let text = "";
        if (candidate?.content?.parts) {
            text = candidate.content.parts.map(p => p.text || "").join("");
        }

        const toolCalls: ToolCall[] = [];
        const mergedCalls = new Map<string, ToolCall>();

        if (candidate?.content?.parts) {
            // First pass: capture the global or part-specific thought_signature
            let messageLevelSignature: string | undefined;
            candidate.content.parts.forEach(part => {
                const partObj = part as Record<string, unknown>;
                const sig = partObj['thought_signature'];
                if (typeof sig === 'string' && sig) {
                    messageLevelSignature = sig;
                }
            });

            candidate.content.parts.forEach((part) => {
                if (part.functionCall) {
                    const call = part.functionCall;
                    const name = call.name;
                    if (name) {
                        const safeArgs = (call.args && typeof call.args === 'object') ? call.args : {};
                        
                        const partObj = part as Record<string, unknown>;
                        const partSignature = partObj['thought_signature'];
                        const finalSignature = typeof partSignature === 'string' ? partSignature : messageLevelSignature;

                        const existing = mergedCalls.get(name);
                        if (existing) {
                            // Merge arguments for partial chunks
                            existing.args = { ...existing.args, ...safeArgs };
                            if (finalSignature && !existing.thought_signature) {
                                existing.thought_signature = finalSignature;
                            }
                        } else {
                            mergedCalls.set(name, {
                                args: { ...safeArgs },
                                name,
                                thought_signature: finalSignature
                            });
                        }
                    }
                }
            });

            mergedCalls.forEach(call => toolCalls.push(call));
        }

        return {
            content: text,
            rawContent: candidate?.content?.parts,
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
        const { tokenCount, values } = await this.embedText(text, { taskType: 'RETRIEVAL_QUERY' });
        return { tokenCount, vector: values };
    }

    public async embedDocument(text: string, title?: string): Promise<{ tokenCount: number; vectors: number[][] }> {
        const { tokenCount, values } = await this.embedText(text, { taskType: 'RETRIEVAL_DOCUMENT', title });
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
                    await new Promise(resolve => activeWindow.setTimeout(resolve, delay));
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
