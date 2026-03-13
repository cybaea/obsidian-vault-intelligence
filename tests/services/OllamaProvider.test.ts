/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking private methods for unit testing adaptation logic */
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
            (ModelRegistry as any).fetchOllamaModelDetails = vi.fn().mockResolvedValue(mockModel);

            const body = await (service as any).prepareRequestBody(messages, options, false);
            
            expect(body.tools).toHaveLength(1);
            expect(body.tools[0].type).toBe('function');
            expect(body.tools[0].function.name).toBe('get_weather');
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
            (Platform as any).isDesktopApp = false;

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
            (globalThis as any).fetch = mockFetch;

            const stream = service.generateMessageStream([{ content: 'test', role: 'user' }], {});
            
            await expect(async () => {
                for await (const chunk of stream) {
                   if (chunk.text && chunk.text.length > 0) break;
                }
            }).rejects.toThrow("NDJSON stream chunk exceeded maximum safe buffer size.");
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of private method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of private method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of private method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of private method mocking */
