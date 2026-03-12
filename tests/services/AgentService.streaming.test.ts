/* eslint-disable @typescript-eslint/no-explicit-any -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-call -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- We use any for complex model mocks in tests */
import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../../src/services/AgentService';

vi.mock('../../src/tools/ToolRegistry', () => ({
    ToolRegistry: class {
        execute = vi.fn();
        getTools = vi.fn().mockReturnValue([]);
    }
}));

describe('AgentService Streaming', () => {
    let service: AgentService;
    let mockApp: App;
    let mockReasoningClient: any;
    let mockGraphService: any;
    let mockEmbeddingClient: any;
    let mockSettings: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApp = {
            vault: {},
            workspace: { 
                getActiveFile: vi.fn().mockReturnValue(null),
                iterateRootLeaves: vi.fn()
            }
        } as any;
        mockReasoningClient = {
            generateMessageStream: vi.fn(),
            initialize: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: true,
            terminate: vi.fn()
        };
        mockGraphService = {};
        mockEmbeddingClient = {};
        mockSettings = {
            chatModel: 'test-model',
            contextWindowTokens: 4000,
            systemInstruction: 'You are an agent.'
        };

        service = new AgentService(
            mockApp,
            mockReasoningClient,
            mockReasoningClient,
            mockGraphService,
            mockEmbeddingClient,
            mockSettings
        );
    });

    it('should stream text correctly', async () => {
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { text: 'Hello' };
            yield { text: ' world' };
            yield { isDone: true, text: '!' };
            yield { rawContent: [{ text: 'Hello world!' }] }; // Final metadata chunk from provider
        })();
        mockReasoningClient.generateMessageStream.mockReturnValue(mockStream);

        const chunks: any[] = [];
        for await (const chunk of service.chatStream([], 'test', [], {})) {
            chunks.push(chunk);
        }

        // Now expected 5 chunks: 'Hello', ' world', '!', model-metadata, final-isDone
        expect(chunks).toHaveLength(5);
        expect(chunks[0].text).toBe('Hello');
        expect(chunks[1].text).toBe(' world');
        expect(chunks[2].text).toBe('!');
        // Chunk 3 is metadata (rawContent/toolCalls)
        expect(chunks[3].rawContent).toBeDefined();
        // Chunk 4 is isDone: true
        expect(chunks[4].isDone).toBe(true);
    });

    it('should handle tool call loop in stream', async () => {
        // Mock ToolRegistry execute
        const toolExecuteMock = vi.fn().mockResolvedValue({ content: "Tool result" });
        (service as any).toolRegistry.execute = toolExecuteMock;

        // First stream returns a tool call
        const stream1 = (async function* () {
            await Promise.resolve();
            yield { toolCalls: [{ args: { q: 'query' }, name: 'test_tool' }] };
        })();

        // Second stream returns final text
        const stream2 = (async function* () {
            await Promise.resolve();
            yield { text: 'Final answer' };
            yield { isDone: true };
        })();

        mockReasoningClient.generateMessageStream
            .mockReturnValueOnce(stream1)
            .mockReturnValueOnce(stream2);

        const chunks: any[] = [];
        for await (const chunk of service.chatStream([], 'test', [], {})) {
            chunks.push(chunk);
        }

        const thinkingChunks = chunks.filter(c => c.status?.includes('Thinking'));
        if (thinkingChunks.length === 0) {
            throw new Error(`No thinking chunks found. Received: ${JSON.stringify(chunks)}`);
        }
        expect(chunks.find(c => c.text === 'Final answer')).toBeDefined();
        
        // Check that toolResults were yielded
        const toolResultChunk = chunks.find(c => c.toolResults);
        expect(toolResultChunk).toBeDefined();
        expect(toolResultChunk.toolResults[0].result).toEqual({ content: "Tool result" });

        expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    });

    it('should honor AbortSignal', async () => {
        const controller = new AbortController();
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { text: 'Part 1' };
            controller.abort();
            yield { text: 'Part 2' };
        })();
        mockReasoningClient.generateMessageStream.mockReturnValue(mockStream);

        const chunks: any[] = [];
        for await (const chunk of service.chatStream([], 'test', [], { signal: controller.signal })) {
            chunks.push(chunk);
        }

        if (chunks.length !== 1) {
            throw new Error(`Expected 1 chunk but got ${chunks.length}. Received: ${JSON.stringify(chunks)}`);
        }
        expect(chunks[0].text).toBe('Part 1');
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-argument -- End of model mock section */
