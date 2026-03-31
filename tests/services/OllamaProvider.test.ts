import { App, Platform, requestUrl } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

import { ModelRegistry } from '../../src/services/ModelRegistry';
import { OllamaProvider } from '../../src/services/OllamaProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        Platform: {
            isDesktopApp: true,
            isMobile: false,
        },
        requestUrl: vi.fn(),
    };
});

describe('OllamaProvider', () => {
    let service: OllamaProvider;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock crypto.randomUUID for internal tool extraction logic
        Object.defineProperty(globalThis, 'crypto', {
            value: { randomUUID: () => "test-uuid-1234", subtle: {} },
            writable: true
        });
        
        mockSettings = {
            chatModel: 'ollama/llama3',
            contextWindowTokens: 4096,
            embeddingModel: 'ollama/nomic-embed-text',
            ollamaEndpoint: 'http://localhost:11434',
        } as unknown as VaultIntelligenceSettings;

        mockApp = {
            //@ts-ignore
            plugins: {
                plugins: {
                    "obsidian-vault-intelligence": {
                        manifest: { version: "1.0.0" }
                    }
                }
            }
        } as unknown as App;

        service = new OllamaProvider(mockSettings, mockApp);

        // Reset global test state
        (Platform as { isDesktopApp?: boolean }).isDesktopApp = true;
        if ('fetch' in globalThis) {
            Reflect.deleteProperty(globalThis, 'fetch');
        }
    });

    describe('Tool Symmetry', () => {
        it('should correctly format tools for Ollama API', async () => {
            const messages = [
                { content: 'test', role: 'user' as const }
            ];
            const options = {
                modelId: 'ollama/llama3',
                tools: [
                    {
                        description: 'Get weather for a city',
                        name: 'get_weather',
                        parameters: {
                            properties: {
                                city: { type: 'string' }
                            },
                            required: ['city'],
                            type: 'object'
                        }
                    }
                ]
            };

            (requestUrl as Mock).mockResolvedValue({
                json: { 
                    model_info: { 'llama.context_length': 8192 },
                    template: "{{ .Tools }}"
                },
                status: 200
            });

            // Mock ModelRegistry to return the model so JIT details can be applied
            const mockModel = { 
                id: 'ollama/llama3', 
                inputTokenLimit: 8192,
                provider: 'ollama', 
                supportedMethods: ['generateContent', 'nativeTools']
            };
            vi.spyOn(ModelRegistry, 'fetchOllamaModelDetails').mockResolvedValue(mockModel as unknown as never);

            const mockService = service as unknown as { prepareRequestBody: (msg: unknown, opt: unknown, stream: boolean) => Promise<{ tools: { type: string, function: { name: string } }[] }> };
            const body = await mockService.prepareRequestBody(messages, options, false);
            
            expect(body.tools).toBeDefined();
            expect(body.tools[0]?.type).toBe('function');
            expect(body.tools[0]?.function.name).toBe('get_weather');
        });
    });

    describe('Embedding Concurrency', () => {
        it('should handle embedding requests via requestUrl', async () => {
            (requestUrl as Mock).mockResolvedValue({
                json: { embeddings: [[0.1, 0.2]] },
                status: 200
            });

            const result = await service.embedDocument("test 1");
            expect(result.vectors).toHaveLength(1);
            expect(requestUrl).toHaveBeenCalled();
        });
    });

    describe('Buffer Safety', () => {
        it('should throw error if mobile buffer exceeds limit', async () => {
            (Platform as { isDesktopApp?: boolean }).isDesktopApp = false;

            const mockReader = {
                read: vi.fn(),
                releaseLock: vi.fn()
            };

            // Mock reader.read to return a giant chunk
            mockReader.read
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array(1024 * 1024 + 100)
                })
                .mockResolvedValueOnce({ done: true });

            const mockFetch = vi.fn().mockResolvedValue({
                body: {
                    getReader: () => mockReader
                },
                ok: true
            });
            const globalWithFetch = globalThis as typeof globalThis & { fetch: unknown };
            globalWithFetch.fetch = mockFetch;

            const stream = service.generateMessageStream([{ content: 'test', role: 'user' }], {});
            
            await expect(async () => {
                for await (const chunk of stream) {
                   if (chunk.text && chunk.text.length > 0) break;
                }
            }).rejects.toThrow("NDJSON stream chunk exceeded maximum safe buffer size.");
        });
    });

    describe('JSON Resilience', () => {
        it('should strip markdown fences from local model JSON responses', async () => {
            (requestUrl as Mock).mockResolvedValue({
                json: { message: { content: "```json\n{\"test\":\"value\"}\n```" } },
                status: 200
            });
            
            const { z } = await import('zod');
            const schema = z.object({ test: z.string() });
            
            // Mock ModelRegistry to skip network checks
            const mockModel = { id: 'ollama/llama3', inputTokenLimit: 8192, provider: 'ollama', supportedMethods: ['generateStructured'] };
            vi.spyOn(ModelRegistry, 'fetchOllamaModelDetails').mockResolvedValue(mockModel as unknown as never);
            vi.spyOn(ModelRegistry, 'getModelById').mockReturnValue(mockModel as unknown as never);
            
            const result = await service.generateStructured([], schema, { modelId: 'ollama/llama3' });
            expect(result).toHaveProperty('test', 'value');
        });
    });

    describe('Streaming Resilience', () => {
        it('should preserve Basic Auth headers for Node streaming', async () => {
            mockSettings.ollamaEndpoint = 'http://user:pass@localhost:11434';
            service = new OllamaProvider(mockSettings, mockApp);
            
            // Mock ModelRegistry
            const mockModel = { id: 'ollama/llama3', inputTokenLimit: 8192, provider: 'ollama', supportedMethods: ['generateContent'] };
            vi.spyOn(ModelRegistry, 'fetchOllamaModelDetails').mockResolvedValue(mockModel as unknown as never);
            vi.spyOn(ModelRegistry, 'getModelById').mockReturnValue(mockModel as unknown as never);
            
            let errorCb: undefined | ((err: Error) => void);
            const mockReq = {
                destroy: vi.fn(),
                end: vi.fn(() => {
                    if (errorCb) {
                        errorCb(new Error("Mock abort"));
                    }
                }),
                on: vi.fn(function(event: string, cb: (...args: unknown[]) => void) {
                    if (event === 'error') {
                        errorCb = cb as ((err: Error) => void);
                    }
                    return mockReq;
                }),
                setTimeout: vi.fn(),
                write: vi.fn()
            };
            const requestSpy = vi.fn().mockReturnValue(mockReq);

            const env = globalThis as typeof globalThis & { require: unknown };
            const originalRequire = env.require as (id: string) => unknown;
            const mockRequire = vi.fn((m: string) => {
                if (m === 'http' || m === 'https') return { request: requestSpy };
                if (m === 'url') return { URL: URL };
                if (originalRequire) return originalRequire(m);
                throw new Error(`Cannot require ${m} in test environment`);
            });
            Object.defineProperty(globalThis, 'require', { value: mockRequire, writable: true });
            
            try {
                const stream = service.generateMessageStream([], {});
                await stream.next();
            } catch {
                // Ignore expected mock abort
            } finally {
                Object.defineProperty(globalThis, 'require', { value: originalRequire, writable: true });
            }
            
            expect(requestSpy).toHaveBeenCalled();
            const callArgs = requestSpy.mock.calls[0]?.[0] as { auth?: string };
            expect(callArgs?.auth).toBe("user:pass");
        });
    });

    describe('Streaming NDJSON Parsing', () => {
        it('should correctly parse interleaved text and tool calls in a single chunk', () => {
            const mockStreamState = { fullMessageText: "", inToolCall: false, tempToolCallBuffer: "" };
            const mockChunk = {
                created_at: "now",
                done: false,
                message: { 
                    content: "Text A <tool_call>{\"name\":\"tool1\"}</tool_call> Text B <tool_call>{\"name\":\"tool2\"}</tool_call>",
                    role: "assistant"
                },
                model: "llama3"
            };
            
            // Access private method to test state machine directly
            const mockService = service as unknown as { processNdjsonChunk: (chunk: unknown, state: unknown) => IterableIterator<{text?: string}> };
            const iterator = mockService.processNdjsonChunk(mockChunk, mockStreamState);
            
            const results = [];
            for (const item of iterator) {
                results.push(item);
            }
            
            expect(results).toHaveLength(2);
            expect(results[0]?.text).toBe("Text A ");
            expect(results[1]?.text).toBe(" Text B ");
        });

        it('should handle tool call content spanning across multiple chunks securely', () => {
             const mockStreamState = { fullMessageText: "", inToolCall: false, tempToolCallBuffer: "" };
             const mockService = service as unknown as { processNdjsonChunk: (chunk: unknown, state: unknown) => IterableIterator<{text?: string}> };
             
             const chunk1 = {
                 created_at: "now", done: false, message: { content: "Start <tool_call>{\"name\":", role: "assistant" },
                 model: "llama3"
             };
             const chunk2 = {
                 created_at: "now", done: false, message: { content: "\"tool1\"}</", role: "assistant" },
                 model: "llama3"
             };
             const chunk3 = {
                 created_at: "now", done: false, message: { content: "tool_call> End", role: "assistant" },
                 model: "llama3"
             };

             const results = [];
             for (const item of mockService.processNdjsonChunk(chunk1, mockStreamState)) results.push(item);
             for (const item of mockService.processNdjsonChunk(chunk2, mockStreamState)) results.push(item);
             for (const item of mockService.processNdjsonChunk(chunk3, mockStreamState)) results.push(item);
             
             expect(results).toHaveLength(2);
             expect(results[0]?.text).toBe("Start ");
             expect(results[1]?.text).toBe(" End");
             expect(mockStreamState.inToolCall).toBe(false);
             expect(mockStreamState.tempToolCallBuffer).toBe("");
        });
        
        it('should gracefully recover and scrub malformed JSON in fallback extraction', () => {
             const mockService = service as unknown as { extractFallbackToolCalls: (text: string) => { toolCalls: unknown[], scrubbedText: string } };
             const text = "Prefix \n```json\n{malformed: 'json'} \n```\n Suffix";
             
             const result = mockService.extractFallbackToolCalls(text);
             expect(result.toolCalls).toHaveLength(0); // Fails to parse but doesn't throw
             expect(result.scrubbedText).toBe("Prefix \n```json\n{malformed: 'json'} \n```\n Suffix"); // Preserves the malformed block because it might be valid code!
        });
    });

    describe('Robust JSON Parsing', () => {
        it('should successfully extract Tool Calls from text containing nested brackets and markdown boundaries', () => {
            const mockService = service as unknown as { extractFallbackToolCalls: (text: string) => { toolCalls: Array<{ name: string; args: Record<string, string>; internal_state: unknown[] }> } };
            const input = `Here is the requested tool call spanning multiple lines:
\`\`\`json
{"name":"query", "arguments":{"sql": "SELECT * FROM users WHERE metadata = 'key'"}, "internal_state": [1, [2, 3]]}
\`\`\`
And here is some random trailing text that should be ignored.`;
            
            const results = mockService.extractFallbackToolCalls(input);
            expect(results.toolCalls).toHaveLength(1);
            expect(results.toolCalls[0]?.name).toBe("query");
            expect(results.toolCalls[0]?.args?.sql).toContain('key');
            expect(results.toolCalls[0]?.internal_state).toBeUndefined(); // It is intentionally dropped as it's not a generic parameter
        });
    });
});
