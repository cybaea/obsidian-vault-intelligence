import { App, Platform, requestUrl } from "obsidian";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { VaultIntelligenceSettings } from "../settings/types";
import { ChatOptions, IModelProvider, IReasoningClient, StreamChunk, UnifiedMessage, ProviderError, IEmbeddingClient } from "../types/providers";
import { logger } from "../utils/logger";
import { isExternalUrl } from "../utils/url";
import { ModelRegistry } from "./ModelRegistry";

/**
 * Minimal interface for Node.js http/https response object.
 */
interface NodeResponse extends AsyncIterable<Uint8Array> {
    destroy(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for node event emitters
    on(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Minimal interface for WHATWG stream reader.
 */
interface StreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
}

/**
 * Minimal interface for Node.js http/https request object.
 */
interface NodeRequest {
    destroy(error?: Error): void;
    end(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for node event emitters
    on(event: string, listener: (...args: any[]) => void): this;
    setTimeout(msecs: number, callback?: () => void): this;
    write(chunk: string | Uint8Array): void;
}

/**
 * Local helper to bypass top-level builtin restrictions.
 */
interface NodeSystem {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic require is needed to bypass Obsidian's 'require' restriction for electron-only code
    require: (m: string) => any;
}

/**
 * Interface for Ollama API chat request.
 */
interface OllamaChatRequest {
    format?: string | Record<string, unknown>;
    messages: OllamaMessage[];
    model: string;
    options: {
        num_ctx: number;
    };
    stream: boolean;
    tools?: OllamaTool[];
}

/**
 * Interface for Ollama message format.
 */
interface OllamaMessage {
    content: string;
    role: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        function: {
            arguments: Record<string, unknown>;
            name: string;
        };
    }>;
}

/**
 * Interface for Ollama tool definition.
 */
interface OllamaTool {
    function: {
        description: string;
        name: string;
        parameters: Record<string, unknown>;
    };
    type: string;
}

/**
 * Interface for Ollama API response chunks (NDJSON)
 */
interface OllamaChatChunk {
    created_at: string;
    done: boolean;
    eval_count?: number;
    eval_duration?: number;
    load_duration?: number;
    message?: {
        content: string;
        role: string;
        tool_calls?: Array<{
            function: {
                arguments: Record<string, unknown>;
                name: string;
            };
        }>;
    };
    model: string;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    total_duration?: number;
}

interface OllamaVersionResponse {
    version: string;
}

/**
 * Provider for local models via Ollama.
 * Uses Obsidian's requestUrl to bypass CORS and implement SSRF protection.
 */
export class OllamaProvider implements IReasoningClient, IModelProvider, IEmbeddingClient {
    private static MAX_BUFFER_SIZE = 1024 * 1024; // 1MB buffer cap
    private static SOCKET_TIMEOUT = 30000; // 30s
    private supportsJsonSchema: boolean | null = null;
    private embeddingQueue: Promise<void> = Promise.resolve();
    private activeModels: Set<string> = new Set();

    constructor(private settings: VaultIntelligenceSettings, private _app: App) {}

    async embedQuery(text: string): Promise<{ tokenCount: number; vector: number[] }> {
        const { vectors } = await this.embedDocument(text);
        return { tokenCount: 0, vector: vectors[0] || [] };
    }

    async embedDocument(text: string): Promise<{ tokenCount: number; vectors: number[][] }> {
        return new Promise((resolve, reject) => {
            this.embeddingQueue = this.embeddingQueue.then(async () => {
                try {
                    const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
                    if (!isExternalUrl(endpoint, true)) {
                        throw new ProviderError("Invalid Ollama endpoint (SSRF blocked).", "ollama");
                    }

                    const pureModelStr = this.settings.embeddingModel.replace("ollama/", "");
                    this.activeModels.add(pureModelStr);

                    const response = await requestUrl({
                        body: JSON.stringify({
                            input: [text],
                            model: pureModelStr
                        }),
                        headers: { "Content-Type": "application/json" },
                        method: "POST",
                        url: `${endpoint}/api/embed`
                    });

                    if (response.status !== 200) {
                        throw new Error(`Ollama embedding failed: ${response.text}`);
                    }

                    const data = response.json as { embeddings: number[][] };
                    resolve({ tokenCount: 0, vectors: data.embeddings });
                } catch (err: unknown) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                }
            }).catch(() => {
                // Prevent queue stalling on previous failures
            });
        });
    }

    // Capabilities
    get supportsCodeExecution(): boolean { return false; }
    get supportsStructuredOutput(): boolean { return true; } 
    get supportsTools(): boolean { return true; } 
    get supportsWebGrounding(): boolean { return false; }

    /**
     * Non-streaming chat generation.
     */
    async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        const body = await this.prepareRequestBody(messages, options, false);
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        
        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                throw: true,
                url: `${endpoint}/api/chat`
            });

            const data = response.json as OllamaChatChunk;
            const msg = data.message;
            if (!msg) throw new Error("Ollama returned an empty message.");
            
            return {
                content: msg.content || "",
                role: "model", 
                toolCalls: msg.tool_calls ? msg.tool_calls.map(tc => ({
                    args: tc.function.arguments,
                    name: tc.function.name
                })) : undefined
            };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, "ollama");
        }
    }

    /**
     * Streaming chat generation using NDJSON.
     */
    async *generateMessageStream(messages: UnifiedMessage[], options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const body = await this.prepareRequestBody(messages, options, true);
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");

        // SSRF Protection
        if (!isExternalUrl(endpoint, true)) {
            throw new ProviderError("Invalid Ollama endpoint (SSRF blocked).", "ollama");
        }
        
        if (Platform.isDesktopApp) {
            yield* this.generateNodeStream(endpoint, body, options);
            return;
        }

        try {
            const response = await (globalThis as unknown as { fetch: typeof fetch }).fetch(`${endpoint}/api/chat`, {
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                signal: options.signal
            }) as { body: { getReader: () => StreamReader }, ok: boolean, status: number, text: () => Promise<string> };

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama error (${response.status}): ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("Failed to get stream reader from Ollama");

            const decoder = new TextDecoder();
            let buffer = "";

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || !value) break;

                    buffer += decoder.decode(value, { stream: true });
                    if (buffer.length > OllamaProvider.MAX_BUFFER_SIZE) {
                        throw new Error("NDJSON stream chunk exceeded maximum safe buffer size.");
                    }
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const chunk = JSON.parse(line) as OllamaChatChunk;
                            
                            if (chunk.message) {
                                yield {
                                    text: chunk.message.content,
                                    toolCalls: chunk.message.tool_calls?.map(tc => ({
                                        args: tc.function.arguments,
                                        name: tc.function.name
                                    }))
                                };
                            }

                            if (chunk.done) {
                                yield { isDone: true };
                            }
                        } catch (parseError) {
                            logger.error("[Ollama] Failed to parse NDJSON line", parseError, line);
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") return;
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, "ollama");
        }
    }

    /**
     * Terminate provider - clear used VRAM immediately.
     */
    async terminate(): Promise<void> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        
        for (const model of this.activeModels) {
            try {
                // Unload only models we actively used from VRAM using keepalive 
                // We use fetch since requestUrl doesn't guarantee fire-and-forget strictly on teardown
                await (globalThis as unknown as { fetch: typeof fetch }).fetch(`${endpoint}/api/chat`, {
                    body: JSON.stringify({ keep_alive: 0, messages: [], model }),
                    keepalive: true,
                    method: "POST"
                });
            } catch (e) {
                logger.debug(`[Ollama] Failed to unload model ${model} on termination`, e);
            }
        }
        this.activeModels.clear();
    }

    private async checkOllamaVersion(endpoint: string): Promise<boolean> {
        if (this.supportsJsonSchema !== null) return this.supportsJsonSchema;
        try {
            const response = await requestUrl({ method: "GET", url: `${endpoint}/api/version` });
            if (response.status === 200) {
                const data = response.json as OllamaVersionResponse;
                if (data.version) {
                    const parts = data.version.split(".").map(n => parseInt(n, 10));
                    // Ollama 0.4.0+ supports exact JSON schema in "format"
                    this.supportsJsonSchema = (parts[0] || 0) > 0 || (parts[1] || 0) >= 4;
                } else {
                    this.supportsJsonSchema = false;
                }
            } else {
                this.supportsJsonSchema = false;
            }
        } catch {
            this.supportsJsonSchema = false;
        }
        return this.supportsJsonSchema || false;
    }

    private async *generateNodeStream(endpoint: string, body: OllamaChatRequest, options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const nodeRequire = (globalThis as unknown as NodeSystem).require;
        const httpProvider = (endpoint.startsWith("https") ? nodeRequire("https") : nodeRequire("http")) as { request: (opts: unknown) => NodeRequest };
        const url = new URL(`${endpoint}/api/chat`);
        
        const reqOptions = {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
            hostname: url.hostname,
            method: "POST",
            path: url.pathname + url.search,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
        };

        const req = (httpProvider as { request: (opts: unknown) => NodeRequest }).request(reqOptions);
        
        // Timeout guard
        req.setTimeout(OllamaProvider.SOCKET_TIMEOUT, () => {
            req.destroy(new ProviderError("Connection timeout: Ollama is unreachable.", "ollama"));
        });

        const abortHandler = () => req.destroy();
        options.signal?.addEventListener("abort", abortHandler);

        const promise = new Promise<NodeResponse>((resolve, reject) => {
            req.on("error", (err: Error) => {
                options.signal?.removeEventListener("abort", abortHandler);
                reject(new ProviderError(err.message, "ollama"));
            });
            req.on("response", (res: NodeResponse) => {
                res.on("error", (err: Error) => reject(new ProviderError(err.message, "ollama")));
                resolve(res);
            });
        });

        if (reqOptions.body) req.write(reqOptions.body);
        req.end();

        const res = await promise;
        const decoder = new TextDecoder();
        let buffer = "";

        try {
            for await (const chunk of res) {
                buffer += decoder.decode(chunk as BufferSource, { stream: true });
                if (buffer.length > OllamaProvider.MAX_BUFFER_SIZE) {
                    throw new Error("NDJSON stream chunk exceeded maximum safe buffer size.");
                }

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    const data = JSON.parse(line) as OllamaChatChunk;
                    
                    if (data.message) {
                        yield {
                            text: data.message.content,
                            toolCalls: data.message.tool_calls?.map(tc => ({
                                args: tc.function.arguments,
                                name: tc.function.name
                            }))
                        };
                    }

                    if (data.done) {
                        // Pass exact token telemetry back to service
                        yield { 
                            isDone: true,
                            tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                        };
                    }
                }
            }
        } finally {
            options.signal?.removeEventListener("abort", abortHandler);
            if (res && typeof res === "object" && "destroy" in res) {
                (res as { destroy: () => void }).destroy();
            }
        }
    }

    /**
     * Structured output using Ollama's JSON mode.
     */
    async generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        const supportsSchema = await this.checkOllamaVersion(endpoint);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- zod-to-json-schema's ZodTypeAny type is not perfectly compatible with all z.ZodType<T> versions in Obsidian's environment. any cast is used as safe fallback for schema compatibility.
        const jsonSchema = zodToJsonSchema(schema as any) as Record<string, unknown>;

        const body: OllamaChatRequest = {
            ...await this.prepareRequestBody(messages, options, false),
            // Ollama 0.4.0+ supports exact schema, else fallback to generic "json"
            format: supportsSchema ? jsonSchema : "json"
        };

        // If generic mode, append instructions to ensure compatibility with older models
        if (!supportsSchema) {
            const schemaPrompt = `IMPORTANT: Your response MUST be a valid JSON object matching this schema: ${JSON.stringify(jsonSchema)}`;
            if (body.messages[0]?.role === "system") {
                body.messages[0].content += `\n\n${schemaPrompt}`;
            } else {
                body.messages.unshift({ content: schemaPrompt, role: "system" });
            }
        }

        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                throw: true,
                url: `${endpoint}/api/chat`
            });

            const data = response.json as OllamaChatChunk;
            const content = data.message?.content || "{}";
            
            try {
                return JSON.parse(content) as T;
            } catch (parseErr) {
                logger.error("[Ollama] Failed to parse structured output", parseErr, content);
                throw new Error("Local model failed to generate valid JSON structure.");
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, "ollama");
        }
    }

    /**
     * Web search is not supported for local models.
     */
    searchWithGrounding(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Web grounding is not supported for local Ollama models.", "ollama"));
    }

    /**
     * Native code execution is not supported for local models.
     */
    solveWithCode(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Native code execution is not supported for local Ollama models.", "ollama"));
    }

    /**
     * Shared logic to prepare Ollama request body.
     */
    private async prepareRequestBody(messages: UnifiedMessage[], options: ChatOptions, stream: boolean): Promise<OllamaChatRequest> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        const modelId = options.modelId || this.settings.chatModel;
        
        // JIT Fetch Model Details (Context Length / Dimensions)
        const details = await ModelRegistry.fetchOllamaModelDetails(endpoint, modelId);

        // Map UnifiedMessage roles/content to Ollama format
        const ollamaMessages: OllamaMessage[] = messages.map(m => ({
            content: m.content,
            // Ollama expects 'assistant' and 'tool' (recent versions)
            role: m.role === "model" ? "assistant" : m.role,
            // Map tool results back correctly
            tool_call_id: m.toolResults?.[0]?.id,
            tool_calls: m.toolCalls?.map(tc => ({
                function: {
                    arguments: tc.args,
                    name: tc.name
                }
            }))
        }));

        // Insert system instruction if provided
        if (options.systemInstruction) {
            ollamaMessages.unshift({ 
                content: options.systemInstruction, 
                role: "system"
            });
        }

        // Context length clamping logic
        const nativeLimit = details?.inputTokenLimit || 4096;
        let requestedLimit = options.contextWindowTokens || this.settings.contextWindowTokens;

        // VRAM EXPLOSION GUARD
        // Local models (like deepseek or qwen) often report native limits of 128k to 1M.
        // If a user has a massive context budget from Gemini (e.g., 200k+), Ollama will attempt to 
        // allocate the full Math.min(200k, 128k) = 128k VRAM context, instantly crashing AMD/NVIDIA drivers.
        if (requestedLimit > 32768) {
            logger.warn(`[OllamaProvider] Context budget too high for local inference (${requestedLimit}). Clamping to 8192 to prevent GPU explosion.`);
            requestedLimit = 8192;
        }

        const finalCtx = Math.min(requestedLimit, nativeLimit);
        
        const pureModelStr = modelId.replace("ollama/", "");
        this.activeModels.add(pureModelStr);

        const requestBody: OllamaChatRequest = {
            messages: ollamaMessages,
            model: pureModelStr,
            options: {
                num_ctx: finalCtx
            },
            stream: stream
        };

        // Map tools if available
        if (options.tools && options.tools.length > 0) {
            requestBody.tools = options.tools.map(t => {
                const params = t.parameters as Record<string, unknown>;
                return {
                    function: {
                        description: t.description,
                        name: t.name,
                        parameters: params
                    },
                    type: "function"
                };
            });
        }

        return requestBody;
    }
}
