import { App, Platform, requestUrl } from "obsidian";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { 
    ChatOptions, 
    IEmbeddingClient,
    IModelProvider, 
    IReasoningClient, 
    StreamChunk, 
    ToolCall,
    UnifiedMessage 
} from "../types/providers";

import { OLLAMA_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { ProviderError } from "../types/providers";
import { sanitizeHeaders } from "../utils/headers";
import { logger } from "../utils/logger";
import { resolveSecrets } from "../utils/secrets";
import { isExternalUrl } from "../utils/url";
import { ModelRegistry } from "./ModelRegistry";
/**
 *   Minimal interface for Node.js http/https response object.
 */
interface NodeResponse extends AsyncIterable<Uint8Array> {
    destroy(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 *   Minimal interface for WHATWG stream reader.
 */
interface StreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
}

/**
 *   Minimal interface for Node.js http/https request object.
 */
interface NodeRequest {
    destroy(error?: Error): void;
    end(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    setTimeout(msecs: number, callback?: () => void): this;
    write(chunk: string | Uint8Array): void;
}

/**
 *   Local helper to bypass top-level builtin restrictions.
 */
interface NodeSystem {
    require: (m: string) => unknown;
}

/**
 *   Interface for Ollama API chat request.
 */
interface OllamaChatRequest {
    format?: string | Record<string, unknown>;
    keep_alive?: string | number;
    messages: OllamaMessage[];
    model: string;
    options: {
        num_ctx: number;
    };
    stream: boolean;
    tools?: OllamaTool[];
}

/**
 *   Interface for Ollama message format.
 */
interface OllamaMessage {
    content: string;
    name?: string;
    role: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        function: {
            arguments: Record<string, unknown>;
            name: string;
        };
        id?: string;
    }>;
}

/**
 *   Interface for Ollama tool definition.
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
 *   Interface for Ollama API response chunks (NDJSON)
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
            id?: string;
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

interface NdjsonStreamState {
    fullMessageText: string;
    inToolCall: boolean;
    tempToolCallBuffer: string;
}

/**
 *   Provider for local models via Ollama.
 *   Uses Obsidian's requestUrl to bypass CORS and implement SSRF protection.
 */
export class OllamaProvider implements IReasoningClient, IModelProvider, IEmbeddingClient {
    private cachedOllamaHeaders: Record<string, string> | null = null;
    private cacheTimestamp: number = 0;
    private readonly HEADER_CACHE_TTL = 100; // milliseconds (single request window)
    private supportsJsonSchema: boolean | null = null;
    private embeddingQueue: Promise<void> = Promise.resolve();
    private activeModels: Set<string> = new Set();

    constructor(private settings: VaultIntelligenceSettings, private _app: App) {}

    private async getOllamaHeaders(): Promise<Record<string, string>> {
        const now = Date.now();
        
        // Return cached if within TTL
        if (this.cachedOllamaHeaders && (now - this.cacheTimestamp) < this.HEADER_CACHE_TTL) {
            return this.cachedOllamaHeaders;
        }

        const headers: Record<string, string> = {};
        
        // Extract Basic Auth from URL if present
        try {
            const url = new URL(this.settings.ollamaEndpoint);
            if (url.username || url.password) {
                const auth = btoa(`${url.username}:${url.password}`);
                headers["Authorization"] = `Basic ${auth}`;
            }
        } catch {
            // Ignore invalid URL
        }

        const resolveSecret = (key: string): string | null => {
            try {
                const storage = this._app.secretStorage as unknown as { getSecret: (k: string) => string | null };
                if (storage && storage.getSecret) {
                    return storage.getSecret(key);
                }
            } catch (e) {
                logger.error(`[Ollama] Failed to read secret ${key}`, e);
            }
            return null;
        };
        
        if (this.settings.ollamaHeaders) {
            try {
                const resolved = await resolveSecrets(this.settings.ollamaHeaders, resolveSecret, 'ollama-headers-');
                // Sanitize and merge
                const sanitized = sanitizeHeaders(resolved, logger);
                Object.assign(headers, sanitized);
            } catch (e) {
                logger.error(`[Ollama] Error resolving Ollama headers:`, e);
            }
        }

        this.cachedOllamaHeaders = headers;
        this.cacheTimestamp = now;
        return headers;
    }

    // --- IEmbeddingClient Implementation ---

    public get modelName(): string {
        return this.settings.embeddingModel;
    }

    public get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    public async embedChunks(texts: string[]): Promise<{ tokenCount: number; vectors: number[][] }> {
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
                            input: texts,
                            model: pureModelStr,
                            truncate: true
                        }),
                        headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
                        method: "POST",
                        url: `${endpoint}/api/embed`
                    });

                    if (response.status !== 200) {
                        throw new ProviderError(`Ollama embedding error: ${response.status}`, "ollama", response.status);
                    }

                    const json = response.json as { embeddings: number[][], prompt_eval_count?: number };
                    if (!json.embeddings || json.embeddings.length === 0) {
                        throw new Error("No embeddings returned by Ollama.");
                    }

                    // Matryoshka dimensionality support (slice vector if requested dimension is smaller)
                    const targetDim = this.settings.embeddingDimension;
                    const finalVectors = json.embeddings.map(vec => 
                        (vec.length > targetDim) ? vec.slice(0, targetDim) : vec
                    );

                    const tokens = json.prompt_eval_count || Math.ceil(texts.join("").length / 4);

                    resolve({ tokenCount: tokens, vectors: finalVectors });

                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    logger.error("Ollama Provider embedChunks logic error:", message);
                    reject(new ProviderError(message, "ollama"));
                }
            });
        });
    }

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
                            model: pureModelStr,
                            truncate: true
                        }),
                        headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
                        method: "POST",
                        url: `${endpoint}/api/embed`
                    });

                    if (response.status !== 200) {
                        throw new Error(`Ollama embedding failed: ${response.text}`);
                    }

                    const data = response.json as { embeddings: number[][] };
                    
                    // Matryoshka dimensionality support (slice vector if requested dimension is smaller)
                    const targetDim = this.settings.embeddingDimension;
                    const finalVectors = data.embeddings.map(vec => 
                        (vec.length > targetDim) ? vec.slice(0, targetDim) : vec
                    );

                    resolve({ tokenCount: 0, vectors: finalVectors });
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

    private *processNdjsonChunk(chunk: OllamaChatChunk, state: NdjsonStreamState): IterableIterator<StreamChunk> {
        if (chunk.message) {
            let newText = chunk.message.content;
            state.fullMessageText += newText;

            while (newText.length > 0) {
                if (!state.inToolCall) {
                    const toolCallIdx = newText.indexOf("<tool_call>");
                    if (toolCallIdx !== -1) {
                        if (toolCallIdx > 0) {
                            yield { text: newText.substring(0, toolCallIdx) };
                        }
                        state.inToolCall = true;
                        state.tempToolCallBuffer = "";
                        newText = newText.substring(toolCallIdx + 11); // length of <tool_call>
                    } else {
                        yield { text: newText };
                        newText = "";
                    }
                } else {
                    state.tempToolCallBuffer += newText;
                    const endIdx = state.tempToolCallBuffer.indexOf("</tool_call>");
                    if (endIdx !== -1) {
                        state.inToolCall = false;
                        newText = state.tempToolCallBuffer.substring(endIdx + 12); // remainder after </tool_call>
                        state.tempToolCallBuffer = ""; 
                    } else {
                        newText = ""; // consumed all, wait for next chunk
                    }
                }
            }

            if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
                yield {
                    text: "",
                    toolCalls: chunk.message.tool_calls.map(tc => ({
                        args: tc.function.arguments,
                        id: tc.id || crypto.randomUUID(),
                        name: tc.function.name
                    }))
                };
            }
        }

        if (chunk.done) {
            const extractedToolCalls: ToolCall[] = [];
            let scrubbedText = state.fullMessageText;
            
            const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
            let match;
            while ((match = regex.exec(state.fullMessageText)) !== null) {
                if (!match[1]) continue;
                try {
                    const parsed = JSON.parse(match[1]) as unknown;
                    if (parsed && typeof parsed === 'object') {
                        extractedToolCalls.push(parsed as ToolCall);
                    }
                    scrubbedText = scrubbedText.replace(match[0], "").trim();
                } catch (parseErr) {
                    logger.warn("[Ollama] Failed to parse ReAct JSON", parseErr, match[1]);
                }
            }

            if (extractedToolCalls.length === 0) {
                const extraction = this.extractFallbackToolCalls(state.fullMessageText);
                if (extraction.toolCalls.length > 0) {
                    extractedToolCalls.push(...extraction.toolCalls);
                    scrubbedText = extraction.scrubbedText;
                }
            }

            const tokens = (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0);

            yield { 
                isDone: true,
                replaceText: scrubbedText,
                tokens: tokens > 0 ? tokens : undefined,
                toolCalls: extractedToolCalls.length > 0 ? extractedToolCalls : undefined
            };
        }
    }

    /**
     *   Non-streaming chat generation.
     */
    async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        const body = await this.prepareRequestBody(messages, options, false);
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        
        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
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
     *   Streaming chat generation using NDJSON.
     */
    async*generateMessageStream(messages: UnifiedMessage[], options: ChatOptions): AsyncIterableIterator<StreamChunk> {
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
                headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
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
            const state: NdjsonStreamState = {
                fullMessageText: "",
                inToolCall: false,
                tempToolCallBuffer: ""
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                    }
                    if (done && buffer.trim()) {
                        buffer += "\n";
                    } else if (done) {
                        break;
                    }

                    if (buffer.length > OLLAMA_CONSTANTS.MAX_BUFFER_SIZE) {
                        throw new Error("NDJSON stream chunk exceeded maximum safe buffer size.");
                    }
                    const lines = buffer.split("\n");
                    buffer = done ? "" : (lines.pop() || "");

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const chunk = JSON.parse(line) as OllamaChatChunk;
                            yield* this.processNdjsonChunk(chunk, state);
                        } catch (parseError) {
                            logger.error("[Ollama] Failed to parse NDJSON line", parseError, line);
                        }
                    }

                    if (done) break;
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
     *   Terminate provider - clear used VRAM immediately.
     */
    async terminate(): Promise<void> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        
        for (const model of this.activeModels) {
            try {
                // Unload only models we actively used from VRAM using keepalive 
                // We use fetch since requestUrl doesn't guarantee fire-and-forget strictly on teardown
                await (globalThis as unknown as { fetch: typeof fetch }).fetch(`${endpoint}/api/chat`, {
                    body: JSON.stringify({ keep_alive: 0, messages: [], model }),
                    headers: await this.getOllamaHeaders(),
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
            const response = await requestUrl({ 
                headers: await this.getOllamaHeaders(),
                method: "GET", 
                url: `${endpoint}/api/version` 
            });
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

    private async*generateNodeStream(endpoint: string, body: OllamaChatRequest, options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const nodeRequire = (globalThis as unknown as NodeSystem).require;
        const httpProvider = (endpoint.startsWith("https") ? nodeRequire("https") : nodeRequire("http")) as { request: (opts: unknown) => NodeRequest };
        const url = new URL(`${endpoint}/api/chat`);
        
        const reqOptions = {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
            hostname: url.hostname,
            method: "POST",
            path: url.pathname + url.search,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
        };

        const req = (httpProvider as { request: (opts: unknown) => NodeRequest }).request(reqOptions);
        
        // Timeout guard
        req.setTimeout(OLLAMA_CONSTANTS.SOCKET_TIMEOUT_MS, () => {
            req.destroy(new ProviderError("Connection timeout: Ollama is unreachable.", "ollama"));
        });

        const abortHandler = () => req.destroy();
        options.signal?.addEventListener("abort", abortHandler);

        const promise = new Promise<NodeResponse>((resolve, reject) => {
            req.on("error", (...args: unknown[]) => {
                const err = args[0] as Error;
                options.signal?.removeEventListener("abort", abortHandler);
                reject(new ProviderError(err.message, "ollama"));
            });
            req.on("response", (...args: unknown[]) => {
                const res = args[0] as NodeResponse;
                res.on("error", (...args: unknown[]) => {
                    const err = args[0] as Error;
                    reject(new ProviderError(err.message, "ollama"));
                });
                resolve(res);
            });
        });

        if (reqOptions.body) req.write(reqOptions.body);
        req.end();

        const res = await promise;
        const decoder = new TextDecoder();
        let buffer = "";
        const state: NdjsonStreamState = {
            fullMessageText: "",
            inToolCall: false,
            tempToolCallBuffer: ""
        };

        try {
            for await (const chunk of res) {
                buffer += decoder.decode(chunk as BufferSource, { stream: true });
                if (buffer.length > OLLAMA_CONSTANTS.MAX_BUFFER_SIZE) {
                    throw new Error("NDJSON stream chunk exceeded maximum safe buffer size.");
                }

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line) as OllamaChatChunk;
                        yield* this.processNdjsonChunk(data, state);
                    } catch (parseError) {
                        logger.error("[Ollama] Failed to parse NDJSON line in node stream", parseError, line);
                    }
                }
            }

            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer) as OllamaChatChunk;
                    yield* this.processNdjsonChunk(data, state);
                } catch (parseError) {
                    logger.error("[Ollama] Failed to parse remaining NDJSON buffer in node stream", parseError, buffer);
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
     *   Structured output using Ollama's JSON mode.
     */
    async generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        const supportsSchema = await this.checkOllamaVersion(endpoint);
        const jsonSchema = zodToJsonSchema(schema as unknown as Parameters<typeof zodToJsonSchema>[0]) as Record<string, unknown>;

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
                headers: { "Content-Type": "application/json", ...await this.getOllamaHeaders() },
                method: "POST",
                throw: true,
                url: `${endpoint}/api/chat`
            });

            const data = response.json as OllamaChatChunk;
            let content = data.message?.content || "{}";
            
            // Strip markdown fences for robust parsing of local tools that ignore `format: json`
            content = content.trim();
            const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (match && match[1]) {
                content = match[1].trim();
            }
            
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
     *   Web search is not supported for local models.
     */
    searchWithGrounding(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Web grounding is not supported for local Ollama models.", "ollama"));
    }

    /**
     *   Native code execution execution is not supported for local models.
     */
    solveWithCode(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Native code execution is not supported for local Ollama models.", "ollama"));
    }
    /**
     *   Helper to extract standard JSON tool calls (like React or general instruction-tuned fallback)
     *   AND scrub them from the yielded text to avoid polluting conversation history context.
     */
    private extractFallbackToolCalls(text: string): { scrubbedText: string; toolCalls: ToolCall[] } {
        const toolCalls: ToolCall[] = [];
        let scrubbedText = "";
        
        let i = 0;
        let lastEndIndex = 0;
        
        while (i < text.length) {
            const startIdx = text.indexOf('{', i);
            if (startIdx === -1) {
                break;
            }
            
            // Try to parse an object starting at startIdx
            let depth = 0;
            let inString = false;
            let isEscaped = false;
            let endIdx = -1;
            
            for (let j = startIdx; j < text.length; j++) {
                const char = text[j];
                
                if (inString) {
                    if (isEscaped) {
                        isEscaped = false;
                    } else if (char === '\\') {
                        isEscaped = true;
                    } else if (char === '"') {
                        inString = false;
                    }
                } else {
                    if (char === '"') {
                        inString = true;
                    } else if (char === '{') {
                        depth++;
                    } else if (char === '}') {
                        depth--;
                        if (depth === 0) {
                            endIdx = j;
                            break;
                        }
                    }
                }
            }
            
            if (endIdx !== -1) {
                const potentialJson = text.substring(startIdx, endIdx + 1);
                // Check simple heuristics FIRST before trying to parse
                if (potentialJson.includes('"name"') && (potentialJson.includes('"arguments"') || potentialJson.includes('"parameters"') || potentialJson.includes('"args"'))) {
                    try {
                        const parsed = JSON.parse(potentialJson) as { args?: Record<string, unknown>; arguments?: Record<string, unknown>; name?: string; parameters?: Record<string, unknown> };
                        if (parsed.name && (parsed.arguments || parsed.parameters || parsed.args)) {
                            toolCalls.push({
                                args: parsed.parameters || parsed.arguments || parsed.args || {},
                                id: crypto.randomUUID(), // Ollama requires ID to map results
                                name: parsed.name
                            });
                            // Append text before JSON
                            scrubbedText += text.substring(lastEndIndex, startIdx);
                            lastEndIndex = endIdx + 1;
                            i = endIdx + 1;
                            continue;
                        }
                    } catch {
                        // Silent fail
                    }
                }
            }
            
            // Proceed to the next character after startIdx if parsing failed or was incomplete
            i = startIdx + 1;
        }
        
        scrubbedText += text.substring(lastEndIndex);

        // Clean up empty markdown json fences that might be left behind: ```json\n\n``` or ```\n\n```
        scrubbedText = scrubbedText.replace(/```(?:json)?\s*\n*\s*```/gi, '').trim();

        return { scrubbedText, toolCalls };
    }

    /**
     *   Shared logic to prepare Ollama request body.
     */
    private async prepareRequestBody(messages: UnifiedMessage[], options: ChatOptions, stream: boolean): Promise<OllamaChatRequest> {
        const endpoint = this.settings.ollamaEndpoint.replace(/\/+$/, "");
        const modelId = options.modelId || this.settings.chatModel;
        
        // JIT Fetch Model Details (Context Length / Dimensions)
        const details = await ModelRegistry.fetchOllamaModelDetails(endpoint, modelId, await this.getOllamaHeaders());

        // Map UnifiedMessage roles/content to Ollama format
        const useNativeTools = details?.supportedMethods?.includes("nativeTools");

        const ollamaMessages: OllamaMessage[] = messages.flatMap(m => {
            if (m.role === "tool" && !useNativeTools) {
                return [{
                    content: `Tool Execution Result:\n${JSON.stringify(m.toolResults)}\n\nAnalyze the result and continue your response.`,
                    role: "user" // Fallback for lack of tool role
                }];
            }
            if (m.role === "tool" && useNativeTools && m.toolResults) {
                // Ollama Native Tool API requires one message per tool result
                return m.toolResults.map(tr => ({
                    content: JSON.stringify(tr.result),
                    role: "tool",
                    tool_call_id: tr.id // ID is required to link result back to the specific call
                })) as OllamaMessage[];
            }
            
            let content = m.content || "";
            if (!content && m.role !== "tool") {
                content = (m.toolCalls && m.toolCalls.length > 0 && !useNativeTools) ? `<tool_call>${JSON.stringify(m.toolCalls[0])}</tool_call>` : " ";
            } else if (m.role === "model") {
                // Always scrub potential hallucinated tool calls from the history payload sent back to Ollama
                content = this.extractFallbackToolCalls(content).scrubbedText || " ";
            }
            
            return [{
                content: content,
                // Ollama expects 'assistant' and 'tool' (recent versions)
                role: m.role as "user" | "system" | "assistant" | "tool",
                tool_calls: useNativeTools && m.toolCalls ? m.toolCalls.map(tc => ({
                    function: {
                        arguments: tc.args,
                        name: tc.name
                    },
                    id: tc.id
                })) : undefined
            }];
        });

        // Insert system instruction if provided
        if (options.systemInstruction) {
            ollamaMessages.unshift({ 
                content: options.systemInstruction, 
                role: "system"
            });
        }

        // Context length clamping logic
        const nativeLimit = details?.inputTokenLimit || 4096;
        
        let requestedLimit = options.contextWindowTokens;
        if (!requestedLimit) {
            requestedLimit = ModelRegistry.resolveContextBudget(
                modelId, 
                this.settings.modelContextOverrides || {}, 
                this.settings.contextWindowTokens
            );
        }

        const finalCtx = Math.min(requestedLimit, nativeLimit);
        
        const pureModelStr = modelId.replace("ollama/", "");
        this.activeModels.add(pureModelStr);

        const requestBody: OllamaChatRequest = {
            keep_alive: "5m",
            messages: ollamaMessages,
            model: pureModelStr,
            options: {
                num_ctx: finalCtx
            },
            stream: stream
        };

        // Map tools if available
        if (options.tools && options.tools.length > 0) {
            if (useNativeTools) {
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
            } else {
                // ReAct Polyfill
                const toolsDesc = options.tools.map(t => `- ${t.name}: ${t.description}\n  Args: ${JSON.stringify(t.parameters)}`).join("\n");
                const reactPrompt = `\nYou have access to following tools:\n${toolsDesc}\n\nTo use a tool, you MUST output ONLY the following format:\n<tool_call>{"name": "tool_name", "args": {"arg1": "value"}}</tool_call>\n\nWait for the tool execution result before proceeding.`;
                
                if (requestBody.messages[0]?.role === "system") {
                    requestBody.messages[0].content += reactPrompt;
                } else {
                    requestBody.messages.unshift({ content: reactPrompt, role: "system" });
                }
            }
        }

        return requestBody;
    }
}
