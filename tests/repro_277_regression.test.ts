import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../src/services/AgentService';
import { ProviderRegistry } from '../src/services/ProviderRegistry';
import { GraphService } from '../src/services/GraphService';
import { IEmbeddingClient, IReasoningClient, IModelProvider } from '../src/types/providers';
import { VaultIntelligenceSettings } from '../src/settings';

describe('Regression 277: Missing Response / Double Prompt', () => {
    let agentService: AgentService;
    let mockApp: App;
    let mockReasoningClient: any;
    let mockProviderRegistry: any;

    beforeEach(() => {
        mockApp = {
            vault: {
                getMarkdownFiles: vi.fn().mockReturnValue([]),
                getAbstractFileByPath: vi.fn(),
                cachedRead: vi.fn(),
                metadataCache: {
                    getFileCache: vi.fn()
                }
            },
            workspace: {
                getActiveFile: vi.fn().mockReturnValue(null),
                iterateRootLeaves: vi.fn()
            }
        } as any;

        mockReasoningClient = {
            generateMessageStream: vi.fn().mockImplementation(() => {
                return (async function* () {
                    yield { text: "Response" };
                    yield { isDone: true };
                })();
            })
        };

        mockProviderRegistry = {
            getReasoningClient: vi.fn().mockReturnValue(mockReasoningClient),
            getModelProvider: vi.fn().mockReturnValue({})
        };

        agentService = new AgentService(
            mockApp,
            mockProviderRegistry,
            {} as any,
            {} as any,
            { chatModel: 'test-model' } as any
        );
    });

    it('should NOT have duplicate user messages in history when chat is called', async () => {
        const history: any[] = [{ role: 'user', text: 'My message' }];
        const currentPrompt = 'My message'; // View often sends the same text

        const stream = agentService.chatStream(history, currentPrompt, [], {});
        
        // Advance the stream
        await stream.next();

        const calls = mockReasoningClient.generateMessageStream.mock.calls;
        const sentHistory = calls[0][0];

        // We expect EXACTLY 1 message in history (the current prompt)
        // because the view already added 'My message' to the history array.
        // If we see 2, it's a bug.
        const userMessages = sentHistory.filter((m: any) => m.role === 'user');
        
        console.log("Sent History:", JSON.stringify(sentHistory, null, 2));
        
        expect(userMessages.length).toBe(1);
    });
});
