import { App, requestUrl } from "obsidian";
import { z } from "zod";

import { VaultIntelligenceSettings } from "../settings/types";
import { ChatOptions, IModelProvider, IReasoningClient, StreamChunk, UnifiedMessage, ProviderError } from "../types/providers";
import { logger } from "../utils/logger";

/**
 * Interface for Ollama API chat request.
 */
interface OllamaChatRequest {
    format?: string;
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

/**
 * Provider for local models via Ollama.
 * Uses Obsidian's requestUrl to bypass CORS and implement SSRF protection.
 */
export class OllamaProvider implements IReasoningClient, IModelProvider {
    constructor(private settings: VaultIntelligenceSettings, private app: App) {}

    // Capabilities
    get supportsCodeExecution(): boolean { return false; }
    get supportsStructuredOutput(): boolean { return true; } // Ollama supports "format: json"
    get supportsTools(): boolean { return true; } // Recent Ollama versions (0.5.0+) support tools
    get supportsWebGrounding(): boolean { return false; }

    /**
     * Non-streaming chat generation.
     */
    async generateMessage(messages: UnifiedMessage[], options: ChatOptions): Promise<UnifiedMessage> {
        const body = this.prepareRequestBody(messages, options, false);
        
        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
                throw: true,
                url: `${this.settings.ollamaEndpoint}/api/chat`
            });

            const data = response.json as OllamaChatChunk;
            const msg = data.message;
            
            return {
                content: msg?.content || "",
                role: "model", 
                toolCalls: msg?.tool_calls?.map(tc => ({
                    args: tc.function.arguments,
                    name: tc.function.name
                }))
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
        const body = this.prepareRequestBody(messages, options, true);
        
        try {
            // eslint-disable-next-line no-restricted-globals -- fetch is required for NDJSON streaming; requestUrl buffers entire response
            const response = await fetch(`${this.settings.ollamaEndpoint}/api/chat`, {
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
                signal: options.signal
            });

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
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
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
            if (e instanceof Error && e.name === 'AbortError') return;
            const message = e instanceof Error ? e.message : String(e);
            throw new ProviderError(message, "ollama");
        }
    }

    /**
     * Structured output using Ollama's JSON mode.
     */
    async generateStructured<T>(messages: UnifiedMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T> {
        const body: OllamaChatRequest = {
            ...this.prepareRequestBody(messages, options, false),
            format: "json" // Tell Ollama to output JSON
        };

        // Add instruction to system prompt to follow the schema
        const schemaPrompt = "IMPORTANT: Your response MUST be a valid JSON object.";
        const firstMessage = body.messages[0];
        if (firstMessage && firstMessage.role === 'system') {
            firstMessage.content += `\n\n${schemaPrompt}`;
        } else {
            body.messages.unshift({ content: schemaPrompt, role: 'system' });
        }

        try {
            const response = await requestUrl({
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
                throw: true,
                url: `${this.settings.ollamaEndpoint}/api/chat`
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

    // Unimplemented for local models (require cloud infrastructure)
    searchWithGrounding(): Promise<{ text: string }> {
        return Promise.reject(new Error("Web grounding is not supported for local Ollama models."));
    }
    solveWithCode(): Promise<{ text: string }> {
        return Promise.reject(new Error("Native code execution is not supported for local Ollama models."));
    }

    /**
     * Shared logic to prepare Ollama request body.
     */
    private prepareRequestBody(messages: UnifiedMessage[], options: ChatOptions, stream: boolean): OllamaChatRequest {
        // Map UnifiedMessage roles/content to Ollama format
        const ollamaMessages: OllamaMessage[] = messages.map(m => ({
            content: m.content,
            role: m.role === 'model' ? 'assistant' : m.role,
            // Map tool results back if needed
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
                role: 'system',
                tool_call_id: undefined,
                tool_calls: undefined
            });
        }

        const requestBody: OllamaChatRequest = {
            messages: ollamaMessages,
            model: options.modelId?.replace('ollama/', '') || this.settings.chatModel.replace('ollama/', ''),
            options: {
                num_ctx: options.contextWindowTokens || this.settings.contextWindowTokens
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
                    type: 'function'
                };
            });
        }

        return requestBody;
    }
}
