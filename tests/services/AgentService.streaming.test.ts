import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

import { AgentService } from '../../src/services/AgentService';

vi.mock('../../src/tools/ToolRegistry', () => ({
    ToolRegistry: class {
        execute = vi.fn();
        getTools = vi.fn().mockReturnValue([]);
        updateProvider = vi.fn();
    }
}));

describe('AgentService Streaming', () => {
    let service: AgentService;
    let mockApp: App;
    let mockReasoningClient: unknown;
    let mockGraphService: unknown;
    let mockEmbeddingClient: unknown;
    let mockSettings: unknown;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApp = {
            vault: {},
            workspace: { 
                getActiveFile: vi.fn().mockReturnValue(null),
                iterateRootLeaves: vi.fn()
            }
        } as unknown as App;
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

        const mockProviderRegistry = {
            getModelProvider: vi.fn().mockReturnValue(mockReasoningClient),
            getReasoningClient: vi.fn().mockReturnValue(mockReasoningClient)
        };

        service = new AgentService(
            mockApp,
            mockProviderRegistry as never,
            mockGraphService as never,
            mockEmbeddingClient as never,
            mockSettings as never,
            {} as never
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
        (mockReasoningClient as { generateMessageStream: Mock }).generateMessageStream.mockReturnValue(mockStream);

        const chunks: unknown[] = [];
        for await (const chunk of service.chatStream([], 'test', [], {})) {
            chunks.push(chunk);
        }

        // Now expected 5 chunks: 'Hello', ' world', '!', model-metadata, final-isDone
        expect(chunks).toHaveLength(5);
        expect((chunks[0] as { text: string }).text).toBe('Hello');
        expect((chunks[1] as { text: string }).text).toBe(' world');
        expect((chunks[2] as { text: string }).text).toBe('!');
        // Chunk 3 is metadata (rawContent/toolCalls)
        expect((chunks[3] as { rawContent: unknown[] }).rawContent).toBeDefined();
        // Chunk 4 is isDone: true
        expect((chunks[4] as { isDone: boolean }).isDone).toBe(true);
    });

    it('should handle tool call loop in stream', async () => {
        // Mock ToolRegistry execute
        const toolExecuteMock = vi.fn().mockResolvedValue({ content: "Tool result" });
        (service as unknown as { toolRegistry: { execute: unknown } }).toolRegistry.execute = toolExecuteMock;

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

        (mockReasoningClient as { generateMessageStream: Mock }).generateMessageStream
            .mockReturnValueOnce(stream1)
            .mockReturnValueOnce(stream2);

        const chunks: unknown[] = [];
        for await (const chunk of service.chatStream([], 'test', [], {})) {
            chunks.push(chunk);
        }

        const thinkingChunks = chunks.filter(c => (c as { status?: string }).status?.includes('Thinking'));
        if (thinkingChunks.length === 0) {
            throw new Error(`No thinking chunks found. Received: ${JSON.stringify(chunks)}`);
        }
        expect(chunks.find(c => (c as { text?: string }).text === 'Final answer')).toBeDefined();
        
        // Check that toolResults were yielded
        const toolResultChunk = chunks.find(c => (c as { toolResults?: unknown[] }).toolResults) as { toolResults: { result: unknown }[] };
        expect(toolResultChunk).toBeDefined();
        expect(toolResultChunk.toolResults[0]?.result).toEqual({ content: "Tool result" });

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
        (mockReasoningClient as { generateMessageStream: Mock }).generateMessageStream.mockReturnValue(mockStream);

        const chunks: unknown[] = [];
        for await (const chunk of service.chatStream([], 'test', [], { signal: controller.signal })) {
            chunks.push(chunk);
        }

        if (chunks.length !== 2) {
            throw new Error(`Expected 2 chunks but got ${chunks.length}. Received: ${JSON.stringify(chunks)}`);
        }
        expect((chunks[0] as { text: string }).text).toBe('Part 1');
        
        const finalChunk = chunks[1] as { isCancelled: boolean, error: string, isDone: boolean };
        expect(finalChunk.isCancelled).toBe(true);
        expect(finalChunk.isDone).toBe(true);
        expect(finalChunk.error).toBe('Agent explicitly stopped.');
    });
});
