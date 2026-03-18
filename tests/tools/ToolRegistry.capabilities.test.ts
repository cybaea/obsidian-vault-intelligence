import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mocked } from 'vitest';

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
});
