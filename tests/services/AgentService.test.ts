import { App, TFile } from 'obsidian';
import { Mock, Mocked, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService, ChatMessage } from '../../src/services/AgentService';
import { GraphService } from '../../src/services/GraphService';
import { ProviderRegistry } from '../../src/services/ProviderRegistry';
import { VaultIntelligenceSettings } from '../../src/settings';
import { IEmbeddingClient, IModelProvider, IReasoningClient, UnifiedMessage } from '../../src/types/providers';

vi.mock('../../src/tools/ToolRegistry', () => {
    return {
        ToolRegistry: class {
            execute = vi.fn();
            getTools = vi.fn().mockReturnValue([]);
            updateProvider = vi.fn();
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
    let mockProviderRegistry: ProviderRegistry;

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
            supportsCodeExecution: false,
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

        mockProviderRegistry = {
            getModelProvider: vi.fn().mockReturnValue(mockReasoningClient),
            getReasoningClient: vi.fn().mockReturnValue(mockReasoningClient)
        } as unknown as ProviderRegistry;

        agentService = new AgentService(
            mockApp,
            mockProviderRegistry,
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

    it('should drop files exceeding the context budget and inject a SYSTEM NOTE into the prompt', async () => {
        const assemblerSpy = vi.spyOn((agentService as unknown as { contextAssembler: { assemble: Mock } }).contextAssembler, 'assemble').mockResolvedValue({
            context: 'Test content',
            usedFiles: ['file1.md'] // Only one survived
        });

        mockReasoningClient.generateMessageStream.mockImplementationOnce(() => {
            return (async function* () {
                await Promise.resolve();
                yield { text: 'Done' };
                yield { files: ['file1.md'], isDone: true }; // AgentService passes usedFiles here
            })();
        });

        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
        const mockFile1 = { path: 'file1.md', stat: { size: 100 } } as unknown as TFile;
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
        const mockFile2 = { path: 'file2.md', stat: { size: 100 } } as unknown as TFile;

        const result = await agentService.chat([], "Hello", [mockFile1, mockFile2], { modelId: 'local/test-local-model' });

        expect(result.files).toEqual(['file1.md']); // Verifying DOM blowout fix prevents file2.md being added
        expect(assemblerSpy).toHaveBeenCalled();

        /* eslint-disable @typescript-eslint/unbound-method -- vitest mock access is safe here */
        const gm = mockReasoningClient.generateMessageStream as unknown as { mock: { calls: unknown[][] } };
        /* eslint-enable @typescript-eslint/unbound-method -- restore check */
        
        const firstCall = gm.mock.calls[0] as unknown[];
        const firstCallHistory = firstCall[0] as UnifiedMessage[];
        const promptSentToModel = firstCallHistory[0]?.content || "";
        
        expect(promptSentToModel).toContain('[SYSTEM NOTE: 1 context files were skipped');
    });

    it('should de-duplicate user messages even if separated by UI-only system messages', async () => {
        mockReasoningClient.generateMessageStream.mockImplementationOnce(() => {
            return (async function* () {
                await Promise.resolve();
                yield { text: "Response" };
                yield { isDone: true };
            })();
        });

        const history: ChatMessage[] = [
            { role: 'user', text: 'Persistent Message' },
            { role: 'system', text: '' } // UI-only spotlight message
        ];
        const currentPrompt = 'Persistent Message';

        const stream = agentService.chatStream(history, currentPrompt, [], {});
        await stream.next();

        /* eslint-disable @typescript-eslint/unbound-method -- vitest mock access is safe here */
        const gm = mockReasoningClient.generateMessageStream as unknown as { mock: { calls: unknown[][] } };
        /* eslint-enable @typescript-eslint/unbound-method -- restore check */
        
        const firstCall = gm.mock.calls[0] as unknown[] | undefined;
        const sentHistory = firstCall?.[0] as UnifiedMessage[] | undefined;

        // UI-only system msg should be filtered out, and user msg de-duplicated
        const validMessages = (sentHistory ?? []).filter(m => m.role === 'user' || (m.role === 'system' && m.content));
        expect(validMessages.length).toBe(1); 
        if (validMessages[0]) {
            expect(validMessages[0].role).toBe('user');
            expect(validMessages[0].content).toContain('Persistent Message');
        }
    });
});
