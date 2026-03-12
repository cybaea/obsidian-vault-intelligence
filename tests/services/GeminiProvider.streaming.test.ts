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

        expect(chunks).toHaveLength(2);
        expect(chunks[0].text).toBe('Hello');
        expect(chunks[1].text).toBe(' world');
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

        expect(chunks).toHaveLength(2);
        expect(chunks[0].toolCalls[0].args).toEqual({ first: 'part' });
        expect(chunks[1].toolCalls[0].args).toEqual({ second: 'half' });
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
        expect(chunks[0].text).toBe('Chunk 1');
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of model mock section */
