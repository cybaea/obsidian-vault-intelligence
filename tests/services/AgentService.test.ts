/* eslint-disable @typescript-eslint/no-explicit-any -- We use any for complex model mocks in tests */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- We use any for complex model mocks in tests */
import { App } from 'obsidian';
import { Mock, Mocked, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../../src/services/AgentService';
import { GraphService } from '../../src/services/GraphService';
import { VaultIntelligenceSettings } from '../../src/settings';
import { IEmbeddingClient, IModelProvider, IReasoningClient, UnifiedMessage } from '../../src/types/providers';

vi.mock('../../src/tools/ToolRegistry', () => {
    return {
        ToolRegistry: class {
            execute = vi.fn();
            getTools = vi.fn().mockReturnValue([]);
        }
    };
});

describe('AgentService Integration', () => {
    let agentService: AgentService;
    let mockApp: App;
    let mockReasoningClient: Mocked<IReasoningClient & IModelProvider>;
    let mockGraphService: GraphService;
    let mockEmbeddingClient: IEmbeddingClient;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        mockApp = {
            vault: {
                create: vi.fn(),
                createFolder: vi.fn(),
                getAbstractFileByPath: vi.fn()
            },
            workspace: {
                getActiveFile: vi.fn().mockReturnValue(null),
                iterateRootLeaves: vi.fn()
            }
        } as unknown as App;

        mockReasoningClient = {
            generateMessage: vi.fn(),
            generateMessageStream: vi.fn(),
            generateStructured: vi.fn(),
            initialize: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: true,
            terminate: vi.fn()
        } as any;

        mockGraphService = {
            getSemanticNeighbors: vi.fn().mockResolvedValue([])
        } as unknown as GraphService;

        mockEmbeddingClient = {
            dimensions: 128,
            embedDocument: vi.fn(),
            embedQuery: vi.fn()
        } as unknown as IEmbeddingClient;

        mockSettings = {
            chatModel: 'test-model',
            contextWindowTokens: 4000,
            systemInstruction: 'You are an agent.'
        } as unknown as VaultIntelligenceSettings;

        agentService = new AgentService(
            mockApp,
            mockReasoningClient,
            mockReasoningClient,
            mockGraphService,
            mockEmbeddingClient,
            mockSettings
        );
    });

    it('should correctly loop and invoke tools when the reasoning client returns a ToolCall', async () => {
        // Arrange
        const userPrompt = "Create a note for me.";

        // Mock ToolRegistry execute behavior
        const toolExecuteMock = vi.fn().mockResolvedValue({
            content: "Note created successfully."
        });
        (agentService as unknown as { toolRegistry: { execute: typeof toolExecuteMock } }).toolRegistry.execute = toolExecuteMock;


        mockReasoningClient.generateMessageStream
            .mockImplementationOnce(() => {
                return (async function* () {
                    await Promise.resolve();
                    yield { toolCalls: [{ args: { content: 'hello', path: 'test.md' }, name: 'create_note' }] };
                })();
            })
            .mockImplementationOnce(() => {
                return (async function* () {
                    await Promise.resolve();
                    yield { text: 'I have created the note.' };
                    yield { isDone: true };
                })();
            });

        const result = await agentService.chat([], userPrompt, [], {});

        // Assert
        expect(result.text).toBe('I have created the note.');
        expect(toolExecuteMock).toHaveBeenCalledTimes(1);
        expect(toolExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
            args: { content: 'hello', path: 'test.md' },
            name: 'create_note'
        }));
        
        // Ensure generateMessageStream was called twice (once for the prompt, once with the tool result)
        /* eslint-disable @typescript-eslint/unbound-method -- vitest mock access is safe here */
        expect(mockReasoningClient.generateMessageStream).toHaveBeenCalledTimes(2);

        const gm = mockReasoningClient.generateMessageStream as unknown as { mock: { calls: unknown[][] } };
        const calls = gm.mock.calls;
        /* eslint-enable @typescript-eslint/unbound-method -- restore check */
        const secondCall = calls[1] as unknown[];
        if (!secondCall) throw new Error("Second call to generateMessage not made");
        const secondCallArgs = secondCall[0] as unknown[];
        const toolResponseMessage = secondCallArgs.find((msg) => {
            const m = msg as UnifiedMessage;
            return m.role === 'tool' && m.toolResults?.some(r => r.name === 'create_note');
        }) as UnifiedMessage;
        
        expect(toolResponseMessage).toBeDefined();
        if (toolResponseMessage) {
            expect(toolResponseMessage.role).toBe('tool');
            const result = toolResponseMessage.toolResults?.find(r => r.name === 'create_note');
            expect(result).toBeDefined();
            expect(String(result?.result?.content)).toContain('Note created successfully');
        }
    });

    it('should limit tool call loops to prevent infinite recursions', async () => {
         // Mock generateMessage to constantly return tool calls

        (agentService as unknown as { toolRegistry: { execute: Mock } }).toolRegistry.execute = vi.fn().mockResolvedValue({ content: "Tool response" });

        mockReasoningClient.generateMessageStream.mockImplementation(() => {
            return (async function* () {
                await Promise.resolve();
                yield { toolCalls: [{ args: {}, name: 'some_tool' }] };
            })();
        });

        const result = await agentService.chat([], "Keep calling tools", [], {});
        
        // It should eventually abort and return the final tool call content due to max turns logic in AgentService
        // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock access
        expect(mockReasoningClient.generateMessageStream).toHaveBeenCalledTimes(5);
        expect(result.text).toContain('reached the step limit');
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of model mock section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of model mock section */
