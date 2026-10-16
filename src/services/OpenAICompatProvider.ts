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

import { OPENAI_COMPAT_CONSTANTS, OPENAI_COMPAT_MODEL_PREFIX } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { ProviderError } from "../types/providers";
import { sanitizeHeaders } from "../utils/headers";
import { logger } from "../utils/logger";
import { resolveSecrets } from "../utils/secrets";
import { isExternalUrl } from "../utils/url";

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
 *   Interface for OpenAI-compatible chat request bodies.
 */
interface OpenAIChatRequest {
    messages: OpenAIMessage[];
    model: string;
    response_format?: { type: "json_object" };
    stream: boolean;
    tools?: OpenAITool[];
}

/**
 *   Interface for OpenAI-compatible messages.
 */
interface OpenAIMessage {
    content: string | null;
    role: "assistant" | "system" | "tool" | "user";
    tool_call_id?: string;
    tool_calls?: OpenAIToolCall[];
}

/**
 *   Interface for OpenAI-compatible tool definitions.
 */
interface OpenAITool {
    function: {
        description: string;
        name: string;
        parameters: Record<string, unknown>;
    };
    type: "function";
}

/**
 *   Interface for OpenAI-compatible tool calls. Note that `arguments`
 *   arrives as a JSON-encoded string and must be parsed.
 */
interface OpenAIToolCall {
    function: {
        arguments: string;
        name: string;
    };
    id?: string;
    type?: "function";
}

/**
 *   Interface for OpenAI-compatible non-streaming responses.
 */
interface OpenAIChatResponse {
    choices?: Array<{
        finish_reason?: string | null;
        message?: {
            content?: string | null;
            role?: string;
            tool_calls?: OpenAIToolCall[];
        };
    }>;
    error?: { message?: string };
    usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 *   Interface for OpenAI-compatible SSE stream chunks.
 */
interface OpenAIStreamChunk {
    choices?: Array<{
        delta?: {
            content?: string | null;
            role?: string;
            tool_calls?: Array<{
                function?: {
                    arguments?: string;
                    name?: string;
                };
                id?: string;
                index?: number;
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: { total_tokens?: number };
}

/**
 *   Interface for OpenAI-compatible embeddings responses.
 */
interface OpenAIEmbeddingResponse {
    data?: Array<{
        embedding?: number[];
        index?: number;
    }>;
    usage?: { prompt_tokens?: number };
}

/**
 *   Accumulator state for SSE stream processing.
 */
interface SseStreamState {
    fullMessageText: string;
    toolCalls: Map<number, StreamToolCallAccumulator>;
    totalTokens: number;
}

/**
 *   Incremental accumulator for a single streamed tool call.
 */
interface StreamToolCallAccumulator {
    argsBuffer: string;
    id?: string;
    name: string;
}

const OPENAI_COMPAT_PROVIDER = "openai-compat";
const SSE_DATA_PREFIX = "data:";
const SSE_DONE_SENTINEL = "[DONE]";

/**
 *   Provider for OpenAI-compatible endpoints such as the Kilo Gateway,
 *   LM Studio, llama.cpp server, vLLM, and OpenRouter.
 *   Speaks the OpenAI Chat Completions protocol and uses Obsidian's
 *   requestUrl to bypass CORS and implement SSRF protection.
 */
export class OpenAICompatProvider implements IReasoningClient, IModelProvider, IEmbeddingClient {
    private cachedHeaders: Record<string, string> | null = null;
    private cacheTimestamp: number = 0;
    private readonly HEADER_CACHE_TTL: number = 100; // milliseconds (single request window)
    private embeddingQueue: Promise<void> = Promise.resolve();

    constructor(private settings: VaultIntelligenceSettings, private _app: App) {}

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        const now = Date.now();

        // Return cached if within TTL
        if (this.cachedHeaders && (now - this.cacheTimestamp) < this.HEADER_CACHE_TTL) {
            return this.cachedHeaders;
        }

        const headers: Record<string, string> = {};

        // Extract Basic Auth from URL if present
        try {
            const url = new URL(this.settings.openaiCompatEndpoint);
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
                logger.error(`[OpenAI-compat] Failed to read secret ${key}`, e);
            }
            return null;
        };

        if (this.settings.openaiCompatHeaders) {
            try {
                const resolved = await resolveSecrets(this.settings.openaiCompatHeaders, resolveSecret, 'openai-compat-headers-');
                // Sanitize and merge
                const sanitized = sanitizeHeaders(resolved, logger);
                Object.assign(headers, sanitized);
            } catch (e) {
                logger.error(`[OpenAI-compat] Error resolving headers:`, e);
            }
        }

        this.cachedHeaders = headers;
        this.cacheTimestamp = now;
        return headers;
    }

    /**
     *   Public header resolution for startup model fetches (see main.ts).
     */
    public getResolvedHeaders(): Promise<Record<string, string>> {
        return this.getHeaders();
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
                    const result = await this.requestEmbeddings(texts);
                    resolve(result);
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    logger.error("OpenAI-compat provider embedChunks logic error:", message);
                    reject(e instanceof ProviderError ? e : new ProviderError(message, OPENAI_COMPAT_PROVIDER));
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
                    resolve(await this.requestEmbeddings([text]));
                } catch (e: unknown) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            }).catch(() => {
                // Prevent queue stalling on previous failures
            });
        });
    }

    /**
     *   Shared embeddings request against POST {base}/embeddings. Not every
     *   OpenAI-compatible server offers embeddings (the Kilo Gateway does
     *   not); a clear error guides users to an alternative provider.
     */
    private async requestEmbeddings(texts: string[]): Promise<{ tokenCount: number; vectors: number[][] }> {
        const endpoint = this.settings.openaiCompatEndpoint.replace(/\/+$/, "");
        if (!isExternalUrl(endpoint, true)) {
            throw new ProviderError("Invalid OpenAI-compatible endpoint (SSRF blocked).", OPENAI_COMPAT_PROVIDER);
        }

        const serverModel = this.settings.embeddingModel.replace(OPENAI_COMPAT_MODEL_PREFIX, "");

        // throw: false so 4xx responses (e.g. the 404 for servers without an
        // embeddings endpoint) reach the status handling below instead of rejecting.
        const response = await requestUrl({
            body: JSON.stringify({
                input: texts,
                model: serverModel
            }),
            headers: { "Content-Type": "application/json", ...await this.getHeaders() },
            method: "POST",
            throw: false,
            url: `${endpoint}/embeddings`
        });

        if (response.status !== 200) {
            const guidance = response.status === 404
                ? "This OpenAI-compatible endpoint does not offer embeddings. Pair it with Gemini, Voyage, Transformers.js, or Ollama for Explorer embeddings."
                : `OpenAI-compatible embedding error: ${response.status}`;
            throw new ProviderError(guidance, OPENAI_COMPAT_PROVIDER, response.status);
        }

        const json = response.json as OpenAIEmbeddingResponse;
        const vectors = (json.data || []).map((entry) => entry.embedding || []);

        if (texts.length > 0 && vectors.length !== texts.length) {
            throw new ProviderError("The endpoint returned an incomplete set of embeddings.", OPENAI_COMPAT_PROVIDER);
        }

        // Matryoshka dimensionality support (slice vectors if requested dimension is smaller)
        const targetDim = this.settings.embeddingDimension;
        const finalVectors = vectors.map(vec =>
            (vec.length > targetDim) ? vec.slice(0, targetDim) : vec
        );

        const tokens = json.usage?.prompt_tokens || 0;
        return { tokenCount: tokens, vectors: finalVectors };
    }

    // Capabilities
    get supportsCodeExecution(): boolean { return false; }
    get supportsStructuredOutput(): boolean { return true; }
    get supportsTools(): boolean { return true; }
    get supportsWebGrounding(): boolean { return false; }

    /**
     *   Converts an OpenAI tool call into the unified ToolCall shape,
     *   parsing the JSON-encoded arguments string.
     */
    private toToolCall(tc: OpenAIToolCall): ToolCall {
        let args: Record<string, unknown> = {};
        try {
            if (tc.function.arguments) {
                const parsed = JSON.parse(tc.function.arguments) as unknown;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    args = parsed as Record<string, unknown>;
                }
            }
        } catch (e) {
            logger.warn("[OpenAI-compat] Failed to parse tool call arguments", e, tc.function.arguments);
        }
        return {
            args,
            id: tc.id || crypto.randomUUID(),
            name: tc.function.name
        };
    }

    /**
     *   Processes a single SSE stream chunk: yields text deltas and
     *   accumulates incremental tool calls and token usage.
     */
    private *processSseChunk(chunk: OpenAIStreamChunk, state: SseStreamState): IterableIterator<StreamChunk> {
        for (const choice of chunk.choices || []) {
            const delta = choice.delta;
            if (delta?.content) {
                state.fullMessageText += delta.content;
                yield { text: delta.content };
            }
            if (delta?.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                    const index = tcDelta.index ?? state.toolCalls.size;
                    const entry = state.toolCalls.get(index) || { argsBuffer: "", name: "" };
                    if (tcDelta.id) entry.id = tcDelta.id;
                    if (tcDelta.function?.name) entry.name += tcDelta.function.name;
                    if (tcDelta.function?.arguments) entry.argsBuffer += tcDelta.function.arguments;
                    state.toolCalls.set(index, entry);
                }
            }
        }
        if (chunk.usage?.total_tokens) {
            state.totalTokens = chunk.usage.total_tokens;
        }
    }

    /**
     *   Emits the terminal chunk for a completed stream: the assembled
     *   message text and any tool calls accumulated from the deltas.
     */
    private *finishStream(state: SseStreamState): IterableIterator<StreamChunk> {
        const toolCalls: ToolCall[] = [];
        for (const [, entry] of state.toolCalls) {
            try {
                const parsed = entry.argsBuffer ? JSON.parse(entry.argsBuffer) as unknown : {};
                const args = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {};
                toolCalls.push({
                    args,
                    id: entry.id || crypto.randomUUID(),
                    name: entry.name
                });
            } catch (e) {
                logger.warn("[OpenAI-compat] Failed to parse streamed tool call arguments", e, entry.argsBuffer);
                toolCalls.push({
                    args: {},
                    id: entry.id || crypto.randomUUID(),
                    name: entry.name
                });
            }
        }

        yield {
            isDone: true,
            replaceText: state.fullMessageText,
            tokens: state.totalTokens > 0 ? state.totalTokens : undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }

    /**
     *   Returns the SSE data payload for a line, or null when the line
     *   carries no data event (comments, event/id fields, blanks).
     */
    private extractSsePayload(line: string): string | null {
        const trimmed = line.trim();
        if (!trimmed.startsWith(SSE_DATA_PREFIX)) return null;
        const payload = trimmed.slice(SSE_DATA_PREFIX.length).trim();
        return payload.length > 0 ? payload : null;
    }

    /**
     *   Non-streaming chat generation.
     */
    async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        const body = this.prepareRequestBody(messages, options, false);
        const endpoint = this.settings.openaiCompatEndpoint.replace(/\/+$/, "");

        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json", ...await this.getHeaders() },
                method: "POST",
                throw: true,
                url: `${endpoint}/chat/completions`
            });

            const data = response.json as OpenAIChatResponse;
            const msg = data.choices?.[0]?.message;
            if (!msg) throw new Error("The OpenAI-compatible endpoint returned an empty message.");

            return {
                content: msg.content || "",
                role: "model",
                toolCalls: msg.tool_calls ? msg.tool_calls.map(tc => this.toToolCall(tc)) : undefined
            };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, OPENAI_COMPAT_PROVIDER);
        }
    }

    /**
     *   Streaming chat generation using SSE ("data: ..." events).
     */
    async*generateMessageStream(messages: UnifiedMessage[], options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const body = this.prepareRequestBody(messages, options, true);
        const endpoint = this.settings.openaiCompatEndpoint.replace(/\/+$/, "");

        // SSRF Protection
        if (!isExternalUrl(endpoint, true)) {
            throw new ProviderError("Invalid OpenAI-compatible endpoint (SSRF blocked).", OPENAI_COMPAT_PROVIDER);
        }

        if (Platform.isDesktopApp) {
            yield* this.generateNodeStream(endpoint, body, options);
            return;
        }

        try {
            const response = await (activeDocument.win as unknown as { fetch: typeof fetch }).fetch(`${endpoint}/chat/completions`, {
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json", ...await this.getHeaders() },
                method: "POST",
                signal: options.signal
            }) as { body: { getReader: () => StreamReader }, ok: boolean, status: number, text: () => Promise<string> };

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI-compatible endpoint error (${response.status}): ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("Failed to get stream reader from the OpenAI-compatible endpoint");

            const decoder = new TextDecoder();
            let buffer = "";
            let sawDoneSentinel = false;
            const state: SseStreamState = {
                fullMessageText: "",
                toolCalls: new Map<number, StreamToolCallAccumulator>(),
                totalTokens: 0
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

                    if (buffer.length > OPENAI_COMPAT_CONSTANTS.MAX_BUFFER_SIZE) {
                        throw new Error("SSE stream chunk exceeded maximum safe buffer size.");
                    }
                    const lines = buffer.split("\n");
                    buffer = done ? "" : (lines.pop() || "");

                    for (const line of lines) {
                        const payload = this.extractSsePayload(line);
                        if (payload === null) continue;
                        if (payload === SSE_DONE_SENTINEL) {
                            sawDoneSentinel = true;
                            break;
                        }
                        try {
                            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
                            yield* this.processSseChunk(chunk, state);
                        } catch (parseError) {
                            logger.error("[OpenAI-compat] Failed to parse SSE line", parseError, payload);
                        }
                    }

                    if (sawDoneSentinel || done) break;
                }
            } finally {
                reader.releaseLock();
            }

            yield* this.finishStream(state);
        } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") return;
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, OPENAI_COMPAT_PROVIDER);
        }
    }

    /**
     *   Desktop streaming path using Node's http/https modules.
     */
    private async*generateNodeStream(endpoint: string, body: OpenAIChatRequest, options: ChatOptions): AsyncIterableIterator<StreamChunk> {
        const nodeRequire = (activeDocument.win as unknown as NodeSystem).require;
        const httpProvider = (endpoint.startsWith("https") ? nodeRequire("https") : nodeRequire("http")) as { request: (opts: unknown) => NodeRequest };
        const url = new URL(`${endpoint}/chat/completions`);

        const reqOptions = {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", ...await this.getHeaders() },
            hostname: url.hostname,
            method: "POST",
            path: url.pathname + url.search,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
        };

        const req = httpProvider.request(reqOptions);

        // Timeout guard
        req.setTimeout(OPENAI_COMPAT_CONSTANTS.SOCKET_TIMEOUT_MS, () => {
            req.destroy(new ProviderError("Connection timeout: the OpenAI-compatible endpoint is unreachable.", OPENAI_COMPAT_PROVIDER));
        });

        const abortHandler = () => req.destroy();
        options.signal?.addEventListener("abort", abortHandler);

        const promise = new Promise<NodeResponse>((resolve, reject) => {
            req.on("error", (...args: unknown[]) => {
                const err = args[0] as Error;
                options.signal?.removeEventListener("abort", abortHandler);
                reject(new ProviderError(err.message, OPENAI_COMPAT_PROVIDER));
            });
            req.on("response", (...args: unknown[]) => {
                const res = args[0] as NodeResponse;
                res.on("error", (...args: unknown[]) => {
                    const err = args[0] as Error;
                    reject(new ProviderError(err.message, OPENAI_COMPAT_PROVIDER));
                });
                resolve(res);
            });
        });

        if (reqOptions.body) req.write(reqOptions.body);
        req.end();

        const res = await promise;
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDoneSentinel = false;
        const state: SseStreamState = {
            fullMessageText: "",
            toolCalls: new Map<number, StreamToolCallAccumulator>(),
            totalTokens: 0
        };

        try {
            for await (const chunk of res) {
                buffer += decoder.decode(chunk, { stream: true });
                if (buffer.length > OPENAI_COMPAT_CONSTANTS.MAX_BUFFER_SIZE) {
                    throw new Error("SSE stream chunk exceeded maximum safe buffer size.");
                }

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const payload = this.extractSsePayload(line);
                    if (payload === null) continue;
                    if (payload === SSE_DONE_SENTINEL) {
                        sawDoneSentinel = true;
                        break;
                    }
                    try {
                        const data = JSON.parse(payload) as OpenAIStreamChunk;
                        yield* this.processSseChunk(data, state);
                    } catch (parseError) {
                        logger.error("[OpenAI-compat] Failed to parse SSE line in node stream", parseError, payload);
                    }
                }

                if (sawDoneSentinel) break;
            }

            if (!sawDoneSentinel && buffer.trim()) {
                const payload = this.extractSsePayload(buffer);
                if (payload && payload !== SSE_DONE_SENTINEL) {
                    try {
                        const data = JSON.parse(payload) as OpenAIStreamChunk;
                        yield* this.processSseChunk(data, state);
                    } catch (parseError) {
                        logger.error("[OpenAI-compat] Failed to parse remaining SSE buffer in node stream", parseError, payload);
                    }
                }
            }
        } finally {
            options.signal?.removeEventListener("abort", abortHandler);
            if (res && typeof res === "object" && "destroy" in res) {
                (res as { destroy: () => void }).destroy();
            }
        }

        yield* this.finishStream(state);
    }

    /**
     *   Appends an instruction to the first system message, or inserts a
     *   system message when none exists.
     */
    private appendSystemInstruction(list: OpenAIMessage[], instruction: string): void {
        if (list[0]?.role === "system") {
            list[0].content += `\n\n${instruction}`;
        } else {
            list.unshift({ content: instruction, role: "system" });
        }
    }

    /**
     *   Posts a structured-output request and returns the message content.
     */
    private async postStructuredChat(endpoint: string, body: OpenAIChatRequest): Promise<string> {
        // throw: false so the server's 400 rejection reaches the status mapping
        // below and the generateStructured response_format fallback can trigger.
        const response = await requestUrl({
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", ...await this.getHeaders() },
            method: "POST",
            throw: false,
            url: `${endpoint}/chat/completions`
        });

        if (response.status !== 200) {
            throw new ProviderError(`OpenAI-compatible endpoint error: ${response.status}`, OPENAI_COMPAT_PROVIDER, response.status);
        }

        const data = response.json as OpenAIChatResponse;
        const content = data.choices?.[0]?.message?.content;
        return typeof content === "string" ? content : "";
    }

    /**
     *   Structured output using a JSON schema instruction plus the
     *   json_object response format, with a prompt-only fallback for
     *   servers that reject response_format.
     */
    async generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T> {
        const endpoint = this.settings.openaiCompatEndpoint.replace(/\/+$/, "");
        if (!isExternalUrl(endpoint, true)) {
            throw new ProviderError("Invalid OpenAI-compatible endpoint (SSRF blocked).", OPENAI_COMPAT_PROVIDER);
        }

        const jsonSchema = zodToJsonSchema(schema as unknown as Parameters<typeof zodToJsonSchema>[0]) as Record<string, unknown>;

        const body: OpenAIChatRequest = this.prepareRequestBody(messages, options, false);
        this.appendSystemInstruction(
            body.messages,
            `IMPORTANT: Your response MUST be a valid JSON object matching this schema: ${JSON.stringify(jsonSchema)}`
        );
        body.response_format = { type: "json_object" };

        let content = "";
        try {
            content = await this.postStructuredChat(endpoint, body);
        } catch (e: unknown) {
            // Some OpenAI-compatible servers reject response_format; retry once without it.
            if (e instanceof ProviderError && e.status === 400) {
                body.response_format = undefined;
                content = await this.postStructuredChat(endpoint, body);
            } else {
                throw e;
            }
        }

        // Strip markdown fences for robust parsing of models that ignore the format request
        let cleaned = content.trim();
        const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (match && match[1]) {
            cleaned = match[1].trim();
        }

        try {
            return JSON.parse(cleaned) as T;
        } catch (parseErr) {
            logger.error("[OpenAI-compat] Failed to parse structured output", parseErr, cleaned);
            throw new Error("The OpenAI-compatible model failed to generate a valid JSON structure.");
        }
    }

    /**
     *   Web search is not supported for OpenAI-compatible endpoints.
     */
    searchWithGrounding(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Web grounding is not supported for OpenAI-compatible endpoints.", OPENAI_COMPAT_PROVIDER));
    }

    /**
     *   The OpenAI Chat Completions protocol offers no model unloading;
     *   termination is a no-op for this provider.
     */
    terminate(): Promise<void> {
        return Promise.resolve();
    }

    /**
     *   Native code execution is not supported for OpenAI-compatible endpoints.
     */
    solveWithCode(): Promise<{ text: string }> {
        return Promise.reject(new ProviderError("Native code execution is not supported for OpenAI-compatible endpoints.", OPENAI_COMPAT_PROVIDER));
    }

    /**
     *   Shared logic to prepare OpenAI Chat Completions request bodies.
     *   Vendor slashes inside model IDs (e.g. "anthropic/claude-sonnet-4.5")
     *   are preserved; only the connection namespace prefix is stripped.
     */
    private prepareRequestBody(messages: UnifiedMessage[], options: ChatOptions, stream: boolean): OpenAIChatRequest {
        const modelId = options.modelId || this.settings.chatModel;
        const serverModel = modelId.startsWith(OPENAI_COMPAT_MODEL_PREFIX)
            ? modelId.slice(OPENAI_COMPAT_MODEL_PREFIX.length)
            : modelId;

        const openaiMessages: OpenAIMessage[] = messages.flatMap((m): OpenAIMessage[] => {
            if (m.role === "tool") {
                // The OpenAI protocol requires one message per tool result,
                // linked back to the call by tool_call_id.
                return (m.toolResults || []).map(tr => ({
                    content: JSON.stringify(tr.result),
                    role: "tool" as const,
                    tool_call_id: tr.id || ""
                }));
            }

            if (m.role === "model" && m.toolCalls && m.toolCalls.length > 0) {
                // Assistant messages carrying tool calls must echo them back
                // verbatim (with stringified arguments) for the server to
                // accept the subsequent tool results.
                return [{
                    content: m.content || null,
                    role: "assistant" as const,
                    tool_calls: m.toolCalls.map(tc => ({
                        function: {
                            arguments: JSON.stringify(tc.args),
                            name: tc.name
                        },
                        id: tc.id || "",
                        type: "function" as const
                    }))
                }];
            }

            const role = m.role === "model" ? "assistant" as const : m.role;
            return [{
                content: m.content || "",
                role
            }];
        });

        // Insert system instruction if provided
        if (options.systemInstruction) {
            openaiMessages.unshift({
                content: options.systemInstruction,
                role: "system"
            });
        }

        const requestBody: OpenAIChatRequest = {
            messages: openaiMessages,
            model: serverModel,
            stream
        };

        // Map tools to the OpenAI function-calling format
        if (options.tools && options.tools.length > 0) {
            requestBody.tools = options.tools.map(t => ({
                function: {
                    description: t.description,
                    name: t.name,
                    parameters: t.parameters
                },
                type: "function" as const
            }));
        }

        return requestBody;
    }
}