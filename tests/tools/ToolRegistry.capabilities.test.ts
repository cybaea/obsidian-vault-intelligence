import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mocked } from 'vitest';

import { AGENT_CONSTANTS } from '../../src/constants';
import { ContextAssembler } from '../../src/services/ContextAssembler';
import { GraphService } from '../../src/services/GraphService';
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

    beforeEach(() => {
        mockApp = {} as unknown as App;
        mockSettings = {
            codeModel: '',
            enableCodeExecution: false,
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
            mockFileTools
        );
    }

    it('should return empty tools array if provider does not support tools', () => {
        mockProvider.supportsTools = false;
        const registry = createRegistry(mockProvider);
        const tools = registry.getTools();
        
        expect(tools.length).toBe(0);
    });

    it('should include Google Search if supportsWebGrounding is true', () => {
        mockProvider.supportsTools = true;
        mockProvider.supportsWebGrounding = true;
        const registry = createRegistry(mockProvider);
        const tools = registry.getTools();
        
        const googleSearchTool = tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH);
        expect(googleSearchTool).toBeDefined();
    });

    it('should NOT include Google Search if supportsWebGrounding is false', () => {
        mockProvider.supportsTools = true;
        mockProvider.supportsWebGrounding = false;
        const registry = createRegistry(mockProvider);
        const tools = registry.getTools();
        
        const googleSearchTool = tools.find(t => t.name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH);
        expect(googleSearchTool).toBeUndefined();
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
