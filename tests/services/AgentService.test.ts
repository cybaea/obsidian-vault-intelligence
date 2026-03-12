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
            generateStructured: vi.fn(),
            initialize: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: true,
            terminate: vi.fn()
        } as unknown as Mocked<IReasoningClient & IModelProvider>;

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

        // Mock generateMessage to yield a tool call on first invocation, and a final text on the second
        const toolCallMessage: UnifiedMessage = {
            content: '',
            role: 'model',
            toolCalls: [{
                args: { content: 'hello', path: 'test.md' },
                name: 'create_note'
            }]
        };

        const finalMessage: UnifiedMessage = {
            content: 'I have created the note.',
            role: 'model'
        };

        mockReasoningClient.generateMessage
            .mockResolvedValueOnce(toolCallMessage)
            .mockResolvedValueOnce(finalMessage);

        const result = await agentService.chat([], userPrompt, [], {});

        // Assert
        expect(result.text).toBe('I have created the note.');
        expect(toolExecuteMock).toHaveBeenCalledTimes(1);
        expect(toolExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
            args: { content: 'hello', path: 'test.md' },
            name: 'create_note'
        }));
        
        // Ensure generateMessage was called twice (once for the prompt, once with the tool result)
        /* eslint-disable @typescript-eslint/unbound-method -- vitest mock access is safe here */
        expect(mockReasoningClient.generateMessage).toHaveBeenCalledTimes(2);

        const gm = mockReasoningClient.generateMessage as unknown as { mock: { calls: unknown[][] } };
        const calls = gm.mock.calls;
        /* eslint-enable @typescript-eslint/unbound-method -- restore check */
        const secondCall = calls[1] as unknown[];
        if (!secondCall) throw new Error("Second call to generateMessage not made");
        const secondCallArgs = secondCall[0] as unknown[];
        const toolResponseMessage = secondCallArgs.find((msg) => {
            const m = msg as UnifiedMessage;
            return m.role === 'user' && m.content.includes('Tool Execution Results');
        }) as UnifiedMessage;
        
        expect(toolResponseMessage).toBeDefined();
        if (toolResponseMessage) {
            expect(toolResponseMessage.content).toContain('Tool Execution Results');
            expect(toolResponseMessage.role).toBe('user');
            expect(toolResponseMessage.content).toContain('Note created successfully');
        }
    });

    it('should limit tool call loops to prevent infinite recursions', async () => {
         // Mock generateMessage to constantly return tool calls
         const toolCallMessage: UnifiedMessage = {
            content: '',
            role: 'model',
            toolCalls: [{
                args: {},
                name: 'some_tool'
            }]
        };

        (agentService as unknown as { toolRegistry: { execute: Mock } }).toolRegistry.execute = vi.fn().mockResolvedValue({ content: "Tool response" });

        mockReasoningClient.generateMessage.mockResolvedValue(toolCallMessage);

        const result = await agentService.chat([], "Keep calling tools", [], {});
        
        // It should eventually abort and return the final tool call content due to max turns logic in AgentService
        // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock access
        expect(mockReasoningClient.generateMessage).toHaveBeenCalledTimes(5);
        expect(result.text).toContain('within the step limit');
    });
});
