import { App } from 'obsidian';
import { beforeEach, afterEach, describe, expect, it, vi, Mocked } from 'vitest';

import { AGENT_CONSTANTS } from '../../src/constants';
import { ContextAssembler } from '../../src/services/ContextAssembler';
import { GraphService } from '../../src/services/GraphService';
import { McpClientManager } from '../../src/services/McpClientManager';
import { SearchOrchestrator } from '../../src/services/SearchOrchestrator';
import { VaultIntelligenceSettings } from '../../src/settings';
import { FileTools } from '../../src/tools/FileTools';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { IModelProvider, IReasoningClient } from '../../src/types/providers';

vi.mock('../../src/modals/ToolConfirmationModal', () => ({
    ToolConfirmationModal: {
        open: vi.fn().mockResolvedValue({ path: 'confirmed' })
    }
}));

describe('ToolRegistry Capabilities', () => {
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockProvider: Mocked<IModelProvider>;
    let mockGraphService: GraphService;
    let mockSearchOrchestrator: SearchOrchestrator;
    let mockContextAssembler: ContextAssembler;
    let mockFileTools: FileTools;
    let mockMcpClientManager: McpClientManager;

    beforeEach(() => {
        mockApp = {} as unknown as App;
        mockSettings = {
            codeModel: 'test-model',
            contextWindowTokens: 100000,
            enableCodeExecution: true,
            enableWebSearch: true,
            mcpServers: [],
            modelContextOverrides: {}
        } as unknown as VaultIntelligenceSettings;

        mockProvider = {
            initialize: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: false,
            terminate: vi.fn()
        } as unknown as Mocked<IModelProvider>;
        mockGraphService = {} as unknown as GraphService;
        mockSearchOrchestrator = {} as unknown as SearchOrchestrator;
        mockContextAssembler = {} as unknown as ContextAssembler;
        mockFileTools = {} as unknown as FileTools;
        mockMcpClientManager = {
            getAvailableTools: vi.fn().mockResolvedValue([])
        } as unknown as McpClientManager;
    });

    function createRegistry(provider: IModelProvider) {
        return new ToolRegistry(
            mockApp,
            mockSettings,
            provider as unknown as IReasoningClient,
            provider, // New provider parameter
            mockGraphService,
            mockSearchOrchestrator,
            mockContextAssembler,
            mockFileTools,
            mockMcpClientManager
        );
    }

    it('should return empty tools array if provider does not support tools', async () => {
        mockProvider.supportsTools = false;
        const registry = createRegistry(mockProvider);
        const tools = await registry.getTools();
        
        expect(tools.length).toBe(0);
    });

    describe('Web Search Capabilities', () => {
        it('should include Google Search when enabled in settings AND supported by provider', async () => {
            mockSettings.enableWebSearch = true;
            mockProvider.supportsTools = true;
            mockProvider.supportsWebGrounding = true;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH)).toBeDefined();
        });

        it('should NOT include Google Search when disabled in settings despite provider support', async () => {
            mockSettings.enableWebSearch = false;
            mockProvider.supportsTools = true;
            mockProvider.supportsWebGrounding = true;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH)).toBeUndefined();
        });

        it('should NOT include Google Search when enabled in settings BUT NOT supported by provider', async () => {
            mockSettings.enableWebSearch = true;
            mockProvider.supportsTools = true;
            mockProvider.supportsWebGrounding = false;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH)).toBeUndefined();
        });
    });

    describe('Code Execution Capabilities', () => {
        it('should include Calculator when enabled in settings AND supported by provider', async () => {
            mockSettings.enableCodeExecution = true;
            mockProvider.supportsTools = true;
            mockProvider.supportsCodeExecution = true;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.CALCULATOR)).toBeDefined();
        });

        it('should NOT include Calculator when disabled in settings despite provider support', async () => {
            mockSettings.enableCodeExecution = false;
            mockProvider.supportsTools = true;
            mockProvider.supportsCodeExecution = true;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.CALCULATOR)).toBeUndefined();
        });

        it('should NOT include Calculator when enabled in settings BUT NOT supported by provider', async () => {
            mockSettings.enableCodeExecution = true;
            mockProvider.supportsTools = true;
            mockProvider.supportsCodeExecution = false;
            const registry = createRegistry(mockProvider);
            const tools = await registry.getTools();
            expect(tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.CALCULATOR)).toBeUndefined();
        });
    });

    it('should use the provided modelId to resolve context budget during vault_search', async () => {
        mockProvider.supportsTools = true;
        
        mockSearchOrchestrator.search = vi.fn().mockResolvedValue([{path: 'hello.md', score: 1.0}]);
        mockContextAssembler.assemble = vi.fn().mockResolvedValue({context: 'hello', usedFiles: ['hello.md']});

        const registry = createRegistry(mockProvider);

        const { ModelRegistry } = await import('../../src/services/ModelRegistry');
        const resolveSpy = vi.spyOn(ModelRegistry, 'resolveContextBudget').mockReturnValue(8192);

        await registry.execute({
            args: { query: 'test' },
            createdFiles: new Set(),
            modelId: 'local/test-agent',
            name: AGENT_CONSTANTS.TOOLS.VAULT_SEARCH,
            usedFiles: new Set()
        });

        expect(resolveSpy).toHaveBeenCalledWith('local/test-agent', mockSettings.modelContextOverrides, mockSettings.contextWindowTokens);
    });

    describe('MCP Resource Capabilities', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('should truncate list_mcp_resources to 100 items and append a warning', async () => {
            const registry = createRegistry(mockProvider);
            
            const mockResources = Array.from({ length: 110 }, (_, i) => ({
                name: `Resource ${i}`,
                serverId: 'test-server',
                uri: `file:///${i}.txt`
            }));
            
            mockMcpClientManager.getAvailableResources = vi.fn().mockResolvedValue(mockResources);

            const resultPromise = registry.execute({
                args: {},
                createdFiles: new Set(),
                name: AGENT_CONSTANTS.TOOLS.LIST_MCP_RESOURCES,
                usedFiles: new Set()
            });
            
            await vi.runAllTimersAsync();
            const response = await resultPromise;
            
            expect(response.result as string).toContain('Available MCP Resources:');
            expect(response.result as string).toContain('Resource 99');
            expect(response.result as string).not.toContain('Resource 105');
            expect(response.result as string).toContain('and 10 more resources. Be specific in your queries');
        });

        it('should intelligently truncate read_mcp_resource JSON output', async () => {
            const registry = createRegistry(mockProvider);
            
            const massiveString = 'A'.repeat(10000);
            const massiveJson = JSON.stringify({ payload: massiveString, validJson: true });

            mockMcpClientManager.readResource = vi.fn().mockResolvedValue({
                contents: [{ text: massiveJson }]
            });

            const resultPromise = registry.execute({
                args: { serverId: 'test-server', uri: 'file:///data.json' },
                createdFiles: new Set(),
                name: AGENT_CONSTANTS.TOOLS.READ_MCP_RESOURCE,
                usedFiles: new Set()
            });

            await vi.runAllTimersAsync();
            const response = await resultPromise;
            
            expect(response.result).toBeDefined();
            let parsed: unknown;
            try {
                parsed = JSON.parse(response.result as string);
                expect(parsed).toBeDefined();
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(`JSON truncation resulted in invalid JSON schema: ${message}`);
            }
        });

        it('should timeout and return an error if read_mcp_resource hangs', async () => {
            const registry = createRegistry(mockProvider);
            
            mockMcpClientManager.readResource = vi.fn().mockImplementation(() => {
                return new Promise(resolve => setTimeout(resolve, 100000));
            });

            const resultPromise = registry.execute({
                args: { serverId: 'test-server', uri: 'file:///hang.txt' },
                createdFiles: new Set(),
                name: AGENT_CONSTANTS.TOOLS.READ_MCP_RESOURCE,
                usedFiles: new Set()
            });

            await vi.runAllTimersAsync();
            const response = await resultPromise;
            
            expect(response.error).toContain('Timeout while reading MCP resource: file:///hang.txt');
        });
    });
});
