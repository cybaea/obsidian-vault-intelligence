import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mocked } from 'vitest';

import { AGENT_CONSTANTS } from '../../src/constants';
import { ContextAssembler } from '../../src/services/ContextAssembler';
import { GeminiProvider } from '../../src/services/GeminiProvider';
import { GraphService } from '../../src/services/GraphService';
import { SearchOrchestrator } from '../../src/services/SearchOrchestrator';
import { VaultIntelligenceSettings } from '../../src/settings';
import { FileTools } from '../../src/tools/FileTools';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { IModelProvider } from '../../src/types/providers';

vi.mock('../../src/modals/ToolConfirmationModal', () => ({
    ToolConfirmationModal: {
        open: vi.fn().mockResolvedValue({ path: 'confirmed' })
    }
}));

describe('ToolRegistry Capabilities', () => {
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockProvider: Mocked<IModelProvider>;
    let mockGeminiService: GeminiProvider;
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

        mockGeminiService = {} as unknown as GeminiProvider;
        mockGraphService = {} as unknown as GraphService;
        mockSearchOrchestrator = {} as unknown as SearchOrchestrator;
        mockContextAssembler = {} as unknown as ContextAssembler;
        mockFileTools = {} as unknown as FileTools;
    });

    function createRegistry(provider: IModelProvider) {
        return new ToolRegistry(
            mockApp,
            mockSettings,
            mockGeminiService,
            provider,
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
});
