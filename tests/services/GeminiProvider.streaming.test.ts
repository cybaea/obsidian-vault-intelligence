/* eslint-disable @typescript-eslint/no-explicit-any -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- We use any for complex model mocks in tests */
import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../../src/services/GeminiProvider';
import { VaultIntelligenceSettings } from '../../src/settings';

vi.mock('obsidian', () => ({
    App: vi.fn(),
    Notice: vi.fn(),
}));

describe('GeminiProvider Streaming', () => {
    let service: GeminiProvider;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            geminiRetries: 0,
            googleApiKey: 'AIzaTest',
        } as any;
        mockApp = {} as any;
        service = new GeminiProvider(mockSettings, mockApp);
    });

    it('should aggregate text chunks', async () => {
        // Mock the SDK response
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { 
                candidates: [{ content: { parts: [{ text: 'Hello' }] } }]
            };
            yield { 
                candidates: [{ content: { parts: [{ text: ' world' }] } }]
            };
        })();

        (service as any).getClient = vi.fn().mockResolvedValue({
            models: {
                generateContentStream: vi.fn().mockResolvedValue(mockStream)
            }
        });

        const chunks: any[] = [];
        for await (const chunk of service.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
            chunks.push(chunk);
        }

        // Now expected 3 chunks: 'Hello', ' world', and final rawContent chunk
        expect(chunks).toHaveLength(3);
        expect(chunks[0].text).toBe('Hello');
        expect(chunks[1].text).toBe(' world');
        expect(chunks[2].rawContent).toHaveLength(2);
    });

    it('should aggregate and merge partial functionCall arguments', async () => {
        // Mock partial tool calls across chunks
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { 
                candidates: [{ content: { parts: [{ functionCall: { args: { first: 'part' }, name: 'test_tool' } }] } }]
            };
            yield { 
                candidates: [{ content: { parts: [{ functionCall: { args: { second: 'half' }, name: 'test_tool' } }] } }]
            };
        })();

        (service as any).getClient = vi.fn().mockResolvedValue({
            models: {
                generateContentStream: vi.fn().mockResolvedValue(mockStream)
            }
        });

        const chunks: any[] = [];
        for await (const chunk of service.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
            chunks.push(chunk);
        }

        // Now expected 3 chunks: Partial 1, Partial 2, and final rawContent chunk
        expect(chunks).toHaveLength(3);
        expect(chunks[0].toolCalls[0].args).toEqual({ first: 'part' });
        expect(chunks[1].toolCalls[0].args).toEqual({ second: 'half' });
        expect(chunks[2].rawContent).toHaveLength(2);
    });

    it('should honor AbortSignal and stop yielding', async () => {
        const controller = new AbortController();
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { 
                candidates: [{ content: { parts: [{ text: 'Chunk 1' }] } }]
            };
            controller.abort();
            yield { 
                candidates: [{ content: { parts: [{ text: 'Chunk 2' }] } }]
            };
        })();

        (service as any).getClient = vi.fn().mockResolvedValue({
            models: {
                generateContentStream: vi.fn().mockResolvedValue(mockStream)
            }
        });

        const chunks: any[] = [];
        try {
            for await (const chunk of service.generateMessageStream([{ content: 'hi', role: 'user' }], { signal: controller.signal })) {
                chunks.push(chunk);
            }
        } catch {
            // Some implementations might throw on abort
        }

        expect(chunks).toHaveLength(1);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toBe('Chunk 1');
    });

    it('should maintain thought_signature state across chunks', async () => {
        const mockStream = (async function* () {
            await Promise.resolve();
            // Chunk 1: Thought signature only
            yield { 
                candidates: [{ content: { parts: [{ thought_signature: 'sig_123' } as any] } }]
            };
            // Chunk 2: Function call without signature (must inherit from previous chunk)
            yield { 
                candidates: [{ content: { parts: [{ functionCall: { args: { query: 'test' }, name: 'vault_search' } }] } }]
            };
        })();

        (service as any).getClient = vi.fn().mockResolvedValue({
            models: {
                generateContentStream: vi.fn().mockResolvedValue(mockStream)
            }
        });

        const chunks: any[] = [];
        for await (const chunk of service.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
            chunks.push(chunk);
        }

        // Chunk 1 yielded nothing to the consumer because it had no text or tool calls (internal state update only)
        // Chunk 2 should have the inherited signature
        const toolCallChunk = chunks.find(c => c.toolCalls);
        expect(toolCallChunk).toBeDefined();
        expect(toolCallChunk.toolCalls[0].thought_signature).toBe('sig_123');
    });

    it('should yield rawContent in the final chunk for history preservation', async () => {
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { 
                candidates: [{ content: { parts: [{ text: 'Final Answer' }] } }]
            };
        })();

        (service as any).getClient = vi.fn().mockResolvedValue({
            models: {
                generateContentStream: vi.fn().mockResolvedValue(mockStream)
            }
        });

        const chunks: any[] = [];
        for await (const chunk of service.generateMessageStream([{ content: 'hi', role: 'user' }], {})) {
            chunks.push(chunk);
        }

        const finalChunk = chunks[chunks.length - 1];
        expect(finalChunk.rawContent).toBeDefined();
        expect(finalChunk.rawContent[0].text).toBe('Final Answer');
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of model mock section */
