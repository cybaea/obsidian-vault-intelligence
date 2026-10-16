import { Platform, requestUrl, type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';

import { OpenAICompatProvider } from '../../src/services/OpenAICompatProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';
import { ProviderError } from '../../src/types/providers';

vi.mock('obsidian', () => ({
    Platform: { isDesktopApp: false },
    requestUrl: vi.fn()
}));

interface MockApp {
    secretStorage: {
        getSecret: Mock;
        listSecrets: Mock;
        setSecret: Mock;
    };
}

/**
 * Encodes strings into SSE-style data events separated by newlines.
 */
function sse(...payloads: string[]): Uint8Array {
    const text = payloads.map(p => `data: ${p}`).join('\n\n') + '\n\n';
    return new TextEncoder().encode(text);
}

describe('OpenAICompatProvider', () => {
    let mockApp: MockApp;
    let mockSettings: VaultIntelligenceSettings;
    let provider: OpenAICompatProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();

        mockApp = {
            secretStorage: {
                getSecret: vi.fn(),
                listSecrets: vi.fn(),
                setSecret: vi.fn()
            }
        };

        mockSettings = {
            chatModel: 'openai-compat/anthropic/claude-sonnet-4.5',
            embeddingDimension: 768,
            embeddingModel: 'openai-compat/text-embedding-3-small',
            openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
            openaiCompatHeaders: JSON.stringify({
                'Authorization': 'vi-secret:my-token',
                'X-Custom-Plain': 'plain-value'
            })
        } as unknown as VaultIntelligenceSettings;

        provider = new OpenAICompatProvider(mockSettings, mockApp as unknown as App);
    });

    describe('getHeaders', () => {
        it('should resolve and cache headers', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('secret-token-123');

            const headers = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();

            expect(headers).toEqual({
                'Authorization': 'secret-token-123',
                'X-Custom-Plain': 'plain-value'
            });

            expect(mockApp.secretStorage.getSecret).toHaveBeenCalledWith('openai-compat-headers-my-token');

            // Second call should be cached
            const headers2 = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();
            expect(headers2).toBe(headers);
            expect(mockApp.secretStorage.getSecret).toHaveBeenCalledTimes(1);
        });

        it('should extract basic auth from endpoint URL', async () => {
            mockSettings.openaiCompatEndpoint = 'http://user:pass@localhost:1234';
            mockSettings.openaiCompatHeaders = undefined;

            const headers = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();

            expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz'); // btoa('user:pass')
        });

        it('should filter restricted headers', async () => {
            mockSettings.openaiCompatHeaders = JSON.stringify({
                'Host': 'injected.com',
                'X-Valid': 'ok'
            });

            const headers = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();

            expect(headers['X-Valid']).toBe('ok');
            expect(headers['Host']).toBeUndefined();
        });
    });

    describe('generateMessage', () => {
        it('should parse content and tool calls', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: {
                    choices: [{
                        message: {
                            content: 'hello',
                            role: 'assistant',
                            tool_calls: [{
                                function: { arguments: '{"query":"x"}', name: 'vault_search' },
                                id: 'tc1'
                            }]
                        }
                    }]
                },
                status: 200
            });

            const result = await provider.generateMessage([{ content: 'hi', role: 'user' }], {});

            expect(result.content).toBe('hello');
            expect(result.role).toBe('model');
            expect(result.toolCalls).toEqual([{
                args: { query: 'x' },
                id: 'tc1',
                name: 'vault_search'
            }]);

            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ 'Authorization': 'token123' }),
                method: 'POST',
                url: 'https://ai-gateway.kilo.ai/api/v1/chat/completions'
            }));
        });

        it('should map unified roles and tool history to the OpenAI protocol', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: 'done', role: 'assistant' } }] },
                status: 200
            });

            await provider.generateMessage([
                { content: 'hi', role: 'user' },
                { content: '', role: 'model', toolCalls: [{ args: { q: 'x' }, id: 't1', name: 'vault_search' }] },
                { content: '', role: 'tool', toolResults: [{ id: 't1', name: 'vault_search', result: { count: 1 } }] }
            ], { systemInstruction: 'Be brief.' });

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as {
                messages: Array<{ content: string | null; role: string; tool_call_id?: string; tool_calls?: unknown[] }>;
            };

            expect(body.messages).toHaveLength(4);
            expect(body.messages[0]).toMatchObject({ content: 'Be brief.', role: 'system' });
            expect(body.messages[1]).toMatchObject({ content: 'hi', role: 'user' });
            expect(body.messages[2]).toMatchObject({ role: 'assistant' });
            expect(body.messages[2]?.tool_calls?.[0]).toMatchObject({ id: 't1' });
            expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 't1' });
        });

        it('should strip only the namespace prefix from vendor model IDs', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: 'ok' } }] },
                status: 200
            });

            await provider.generateMessage([{ content: 'hi', role: 'user' }], {});

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as { model: string };
            expect(body.model).toBe('anthropic/claude-sonnet-4.5');
        });

        it('should wrap failures in ProviderError', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockRejectedValue(new Error('401: Unauthorized'));

            await expect(provider.generateMessage([{ content: 'hi', role: 'user' }], {})).rejects.toBeInstanceOf(ProviderError);
        });
    });

    describe('generateMessageStream (SSE)', () => {
        it('should aggregate text deltas and complete accumulated tool calls', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');

            const reader = vi.fn()
                .mockResolvedValueOnce({ done: false, value: sse('{"choices":[{"delta":{"content":"Hello"}}]}') })
                .mockResolvedValueOnce({ done: false, value: sse('{"choices":[{"delta":{"content":" world"}}]}') })
                .mockResolvedValueOnce({
                    done: false,
                    value: sse('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"vault_search","arguments":"{\\"q\\":"}}]}}]}')
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: sse('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]}}]}')
                })
                .mockResolvedValueOnce({ done: false, value: sse('{"choices":[{"finish_reason":"tool_calls"}],"usage":{"total_tokens":42}}') })
                .mockResolvedValueOnce({ done: false, value: sse('[DONE]') })
                .mockResolvedValue({ done: true, value: undefined });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                body: { getReader: () => ({ read: reader, releaseLock: vi.fn() }) },
                ok: true,
                status: 200,
                text: vi.fn()
            }));

            const chunks: Array<Record<string, unknown>> = [];
            for await (const chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                chunks.push(chunk as Record<string, unknown>);
            }

            expect(chunks[0]).toEqual({ text: 'Hello' });
            expect(chunks[1]).toEqual({ text: ' world' });

            const final = chunks[chunks.length - 1] as { isDone?: boolean; replaceText?: string; tokens?: number; toolCalls?: Array<{ args: Record<string, unknown>; id: string; name: string }> };
            expect(final.isDone).toBe(true);
            expect(final.replaceText).toBe('Hello world');
            expect(final.tokens).toBe(42);
            expect(final.toolCalls).toEqual([{
                args: { q: 'x' },
                id: 'tc1',
                name: 'vault_search'
            }]);
        });

        it('should surface HTTP errors as ProviderError', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                body: { getReader: () => ({ read: vi.fn(), releaseLock: vi.fn() }) },
                ok: false,
                status: 401,
                text: vi.fn().mockResolvedValue('Unauthorized')
            }));

            await expect(async () => {
                for await (const _chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                    // Drain; the response error should reject the iterator.
                }
            }).rejects.toThrow('401');
        });

        it('should block non-http endpoints (SSRF)', async () => {
            mockSettings.openaiCompatEndpoint = 'file:///etc/passwd';

            await expect(async () => {
                for await (const _chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                    // Drain; the first call should throw before yielding.
                }
            }).rejects.toThrow('SSRF');
        });
    });

    describe('generateStructured', () => {
        it('should request json_object output and parse the response', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: '{"answer": 1}' } }] },
                status: 200
            });

            const result = await provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({ answer: z.number() }),
                {}
            );

            expect(result).toEqual({ answer: 1 });

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as {
                messages: Array<{ content: string; role: string }>;
                response_format?: { type: string };
            };
            expect(body.response_format).toEqual({ type: 'json_object' });
            expect(body.messages[0]?.content).toContain('MUST be a valid JSON object');
        });

        it('should retry without response_format when the server rejects it', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock)
                .mockResolvedValueOnce({ status: 400 })
                .mockResolvedValueOnce({
                    json: { choices: [{ message: { content: '{"ok": true}' } }] },
                    status: 200
                });

            const result = await provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({ ok: z.boolean() }),
                {}
            );

            expect(result).toEqual({ ok: true });

            const secondBody = JSON.parse((requestUrl as Mock).mock.calls[1]?.[0]?.body as string) as { response_format?: { type: string } };
            expect(secondBody.response_format).toBeUndefined();
            expect((requestUrl as Mock).mock.calls).toHaveLength(2);
            // The fallback depends on the 400 reaching the status mapping;
            // requestUrl must resolve 4xx responses instead of rejecting.
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should not retry structured output on non-400 server failures', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({ status: 500 });

            await expect(provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({}),
                {}
            )).rejects.toThrow('500');
            expect((requestUrl as Mock).mock.calls).toHaveLength(1);
        });

        it('should not retry structured output on transport failures', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockRejectedValue(new Error('connection reset'));

            await expect(provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({}),
                {}
            )).rejects.toThrow('connection reset');
            expect((requestUrl as Mock).mock.calls).toHaveLength(1);
        });

        it('should strip markdown fences before parsing', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: '```json\n{"a": 2}\n```' } }] },
                status: 200
            });

            const result = await provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({ a: z.number() }),
                {}
            );

            expect(result).toEqual({ a: 2 });
        });

        it('should throw when the model returns invalid JSON', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: 'not json at all' } }] },
                status: 200
            });

            await expect(provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({}),
                {}
            )).rejects.toThrow('valid JSON structure');
        });
    });

    describe('embeddings', () => {
        it('should embed chunks with the namespace prefix stripped', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: {
                    data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }, { embedding: [0.4, 0.5, 0.6], index: 1 }],
                    usage: { prompt_tokens: 12 }
                },
                status: 200
            });

            const result = await provider.embedChunks(['one', 'two']);

            expect(result.tokenCount).toBe(12);
            expect(result.vectors).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);

            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: 'https://ai-gateway.kilo.ai/api/v1/embeddings'
            }));

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as { input: string[]; model: string };
            expect(body.model).toBe('text-embedding-3-small');
            expect(body.input).toEqual(['one', 'two']);
        });

        it('should slice vectors to the configured dimension (Matryoshka)', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            mockSettings.embeddingDimension = 2;
            (requestUrl as Mock).mockResolvedValue({
                json: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
                status: 200
            });

            const result = await provider.embedDocument('text');

            expect(result.vectors[0]).toEqual([0.1, 0.2]);
        });

        it('should explain when the server offers no embeddings (404)', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({ status: 404 });

            const error = await provider.embedChunks(['one']).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(ProviderError);
            expect((error as ProviderError).status).toBe(404);
            expect((error as ProviderError).message).toContain('does not offer embeddings');

            // The status mapping relies on requestUrl resolving 4xx responses;
            // with the default throw: true it would reject before the mapping.
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should surface transport failures from the embeddings request', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockRejectedValue(new Error('connection refused'));

            // requestUrl still rejects for network-level failures even with throw: false.
            await expect(provider.embedChunks(['one'])).rejects.toThrow('connection refused');
        });

        it('should reject incomplete embedding sets', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { data: [{ embedding: [0.1] }] },
                status: 200
            });

            await expect(provider.embedChunks(['one', 'two'])).rejects.toBeInstanceOf(ProviderError);
        });

        it('should embed queries through the document path', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { data: [{ embedding: [0.5, 0.6] }] },
                status: 200
            });

            const result = await provider.embedQuery('query text');

            expect(result.vector).toEqual([0.5, 0.6]);
            expect(result.tokenCount).toBe(0);
        });

        it('should block non-http endpoints (SSRF)', async () => {
            mockSettings.openaiCompatEndpoint = 'file:///etc/passwd';

            await expect(provider.embedDocument('text')).rejects.toThrow('SSRF');
        });
    });

    describe('capabilities', () => {
        it('should report OpenAI-compatible capabilities', () => {
            expect(provider.supportsCodeExecution).toBe(false);
            expect(provider.supportsStructuredOutput).toBe(true);
            expect(provider.supportsTools).toBe(true);
            expect(provider.supportsWebGrounding).toBe(false);
        });

        it('should reject web grounding and native code execution', async () => {
            await expect(provider.searchWithGrounding()).rejects.toBeInstanceOf(ProviderError);
            await expect(provider.solveWithCode()).rejects.toBeInstanceOf(ProviderError);
        });

        it('should terminate without error (no-op)', async () => {
            await expect(provider.terminate()).resolves.toBeUndefined();
        });
    });

    describe('generateMessageStream (desktop node transport)', () => {
        const setDesktop = (value: boolean) => {
            Platform.isDesktopApp = value;
        };

        const installNodeTransport = (emitted: Array<Uint8Array>) => {
            let responseListener: ((res: unknown) => void) | undefined;
            const fakeRequest = {
                destroy: vi.fn(),
                end: vi.fn(() => {
                    responseListener?.({
                        destroy: vi.fn(),
                        on: vi.fn(),
                        [Symbol.asyncIterator]: async function* () {
                            for (const chunk of emitted) {
                                yield chunk;
                            }
                        }
                    });
                }),
                on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
                    if (event === 'response') {
                        responseListener = listener;
                    }
                    return fakeRequest;
                }),
                setTimeout: vi.fn(),
                write: vi.fn()
            };
            const win = activeDocument.win as unknown as Record<string, unknown>;
            const original = win.require;
            win.require = vi.fn().mockReturnValue({ request: () => fakeRequest });
            return () => {
                win.require = original;
            };
        };

        it('should stream SSE over the Node http transport on desktop', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            setDesktop(true);
            const restore = installNodeTransport([
                sse('{"choices":[{"delta":{"content":"Hello"}}]}'),
                sse('[DONE]')
            ]);

            try {
                const chunks: Array<Record<string, unknown>> = [];
                for await (const chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                    chunks.push(chunk as Record<string, unknown>);
                }

                expect(chunks[0]).toEqual({ text: 'Hello' });
                const final = chunks[chunks.length - 1] as { isDone?: boolean; replaceText?: string };
                expect(final.isDone).toBe(true);
                expect(final.replaceText).toBe('Hello');
            } finally {
                restore();
                setDesktop(false);
            }
        });

        it('should process a trailing SSE payload left in the node buffer', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            setDesktop(true);
            // The final data event has no trailing newline, so it only parses
            // through the leftover-buffer path after the response ends.
            const tail = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"!"}}]}');
            const restore = installNodeTransport([tail]);

            try {
                const chunks: Array<Record<string, unknown>> = [];
                for await (const chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                    chunks.push(chunk as Record<string, unknown>);
                }

                expect(chunks[0]).toEqual({ text: '!' });
                const final = chunks[chunks.length - 1] as { isDone?: boolean; replaceText?: string };
                expect(final.isDone).toBe(true);
                expect(final.replaceText).toBe('!');
            } finally {
                restore();
                setDesktop(false);
            }
        });

        it('should surface transport errors from the Node request path', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            setDesktop(true);

            let errorListener: ((...args: unknown[]) => void) | undefined;
            const fakeRequest = {
                destroy: vi.fn(),
                end: vi.fn(),
                on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
                    if (event === 'error') {
                        errorListener = listener;
                    }
                    return fakeRequest;
                }),
                setTimeout: vi.fn(),
                write: vi.fn()
            };
            // Fire the error only once the stream is consumed.
            fakeRequest.write.mockImplementation(() => {
                errorListener?.(new Error('socket hang up'));
            });

            const win = activeDocument.win as unknown as Record<string, unknown>;
            const original = win.require;
            win.require = vi.fn().mockReturnValue({ request: () => fakeRequest });

            try {
                await expect(async () => {
                    for await (const _chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                        // Drain; the transport error should reject the iterator.
                    }
                }).rejects.toThrow('socket hang up');
            } finally {
                win.require = original;
                setDesktop(false);
            }
        });
    });

    describe('robustness branches', () => {
        it('should keep empty headers when a referenced secret is missing', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue(null);

            const headers = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();

            expect(headers).toEqual({});
        });

        it('should keep empty headers when secret storage reads fail', async () => {
            mockApp.secretStorage.getSecret.mockImplementation(() => {
                throw new Error('keychain locked');
            });

            const headers = await (provider as unknown as { getHeaders(): Promise<Record<string, string>> }).getHeaders();

            expect(headers).toEqual({});
        });

        it('should default the embedding token count to zero when usage is absent', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { data: [{ embedding: [0.1, 0.2] }] },
                status: 200
            });

            const result = await provider.embedChunks(['one']);

            expect(result.tokenCount).toBe(0);
        });

        it('should not slice vectors already at or below the configured dimension', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            mockSettings.embeddingDimension = 4;
            (requestUrl as Mock).mockResolvedValue({
                json: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
                status: 200
            });

            const result = await provider.embedDocument('text');

            expect(result.vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
        });

        it('should fall back to empty tool args when streamed arguments are invalid JSON', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');

            const reader = vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: sse('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc9","function":{"name":"broken","arguments":"not-json"}}]}}]}')
                })
                .mockResolvedValueOnce({ done: false, value: sse('[DONE]') })
                .mockResolvedValue({ done: true, value: undefined });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                body: { getReader: () => ({ read: reader, releaseLock: vi.fn() }) },
                ok: true,
                status: 200,
                text: vi.fn()
            }));

            const chunks: Array<Record<string, unknown>> = [];
            for await (const chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                chunks.push(chunk as Record<string, unknown>);
            }

            const final = chunks[chunks.length - 1] as { toolCalls?: Array<{ args: Record<string, unknown>; id: string; name: string }> };
            expect(final.toolCalls).toEqual([{ args: {}, id: 'tc9', name: 'broken' }]);
        });

        it('should fall back to empty tool args when response arguments are invalid JSON', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: {
                    choices: [{
                        message: {
                            content: 'hello',
                            tool_calls: [{ function: { arguments: 'not-json', name: 'tool' } }]
                        }
                    }]
                },
                status: 200
            });

            const result = await provider.generateMessage([{ content: 'hi', role: 'user' }], {});

            expect(result.toolCalls?.[0]?.args).toEqual({});
            expect(result.toolCalls?.[0]?.name).toBe('tool');
        });

        it('should map tools to the OpenAI function-calling format', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: 'ok' } }] },
                status: 200
            });

            await provider.generateMessage([{ content: 'hi', role: 'user' }], {
                tools: [{
                    description: 'Search the vault',
                    name: 'vault_search',
                    parameters: { properties: { q: { type: 'string' } }, type: 'object' }
                }]
            });

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as {
                tools?: Array<{ function: { name: string }; type: string }>;
            };
            expect(body.tools?.[0]?.type).toBe('function');
            expect(body.tools?.[0]?.function.name).toBe('vault_search');
        });

        it('should honour an explicit modelId over the settings default', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { choices: [{ message: { content: 'ok' } }] },
                status: 200
            });

            await provider.generateMessage([{ content: 'hi', role: 'user' }], { modelId: 'openai-compat/gpt-4o' });

            const body = JSON.parse((requestUrl as Mock).mock.calls[0]?.[0]?.body as string) as { model: string };
            expect(body.model).toBe('gpt-4o');
        });

        it('should end the stream silently when the request is aborted', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');

            const abortError = new Error('The operation was aborted.');
            abortError.name = 'AbortError';
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

            const chunks: Array<Record<string, unknown>> = [];
            for await (const chunk of provider.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
                chunks.push(chunk as Record<string, unknown>);
            }

            expect(chunks).toHaveLength(0);
        });

        it('should report generic embedding errors with the status code', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({ status: 500 });

            await expect(provider.embedChunks(['one'])).rejects.toThrow('500');
        });

        it('should block structured generation on non-http endpoints (SSRF)', async () => {
            mockSettings.openaiCompatEndpoint = 'file:///etc/passwd';

            await expect(provider.generateStructured(
                [{ content: 'hi', role: 'user' }],
                z.object({}),
                {}
            )).rejects.toThrow('SSRF');
        });
    });
});