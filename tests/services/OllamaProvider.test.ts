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
});

