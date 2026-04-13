import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mocked } from 'vitest';

import { AGENT_CONSTANTS } from '../src/constants';
import { ContextAssembler } from '../src/services/ContextAssembler';
import { GeminiProvider } from '../src/services/GeminiProvider';
import { GraphService } from '../src/services/GraphService';
import { SearchOrchestrator } from '../src/services/SearchOrchestrator';
import { VaultIntelligenceSettings } from '../src/settings';
import { FileTools } from '../src/tools/FileTools';
import { ToolRegistry } from '../src/tools/ToolRegistry';

// Mock ToolConfirmationModal
vi.mock('../src/modals/ToolConfirmationModal', () => ({
    ToolConfirmationModal: {
        open: vi.fn().mockResolvedValue({ path: 'confirmed' })
    }
}));

describe('ToolRegistry Security', () => {
    let toolRegistry: ToolRegistry;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockGeminiService: Mocked<GeminiProvider>;
    let mockGraphService: GraphService;
    let mockSearchOrchestrator: SearchOrchestrator;
    let mockContextAssembler: ContextAssembler;
    let mockFileTools: FileTools;

    beforeEach(() => {
        mockApp = {
            vault: {
                create: vi.fn(),
                createFolder: vi.fn(),
                getAbstractFileByPath: vi.fn(),
                modify: vi.fn(),
                rename: vi.fn(),
            },
            workspace: {
                getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
            },
        } as unknown as App;

        mockSettings = {
            enableAgentWriteAccess: true,
            excludedFolders: [],
            gardenerExcludedFolders: [],
            vaultSearchResultsLimit: 10,
        } as unknown as VaultIntelligenceSettings;

        mockGeminiService = {
            generateMessage: vi.fn(),
            generateStructured: vi.fn(),
            getApiKey: vi.fn(),
            startChat: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: true
        } as unknown as Mocked<GeminiProvider>;
        mockGraphService = {} as unknown as GraphService;
        mockSearchOrchestrator = {} as unknown as SearchOrchestrator;
        mockContextAssembler = {} as unknown as ContextAssembler;
        mockFileTools = {
            createFolder: vi.fn(),
            createNote: vi.fn(),
            listFolder: vi.fn(),
            readNote: vi.fn(),
            renameNote: vi.fn(),
            updateNote: vi.fn(),
        } as unknown as FileTools;

        toolRegistry = new ToolRegistry(
            mockApp,
            mockSettings,
            mockGeminiService,
            mockGeminiService, // Pass mockGeminiService twice since it's used as both reasoning client and provider
            mockGraphService,
            mockSearchOrchestrator,
            mockContextAssembler,
            mockFileTools as unknown as FileTools,
            {} as never
        );
    });

    it('should block path traversal bypass into the internal data directory', async () => {
        const args = {
            content: 'hacked',
            path: 'Allowed/../.vault-intelligence/stolen.md',
        };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.CREATE_NOTE,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });

    it('should block rename destination into the internal data directory', async () => {
        const args = {
            newPath: '.vault-intelligence/note.md',
            path: 'Public/note.md',
        };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.RENAME_NOTE,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });

    it('should block rename source from the internal data directory', async () => {
        const args = {
            newPath: 'Public/note.md',
            path: '.vault-intelligence/secret.md',
        };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.RENAME_NOTE,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });

    it('should block read access to the internal data directory', async () => {
        const args = { path: '.vault-intelligence/secret.md' };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.READ_NOTE,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });

    it('should block listing the internal data directory', async () => {
        const args = { folderPath: '.vault-intelligence' };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.LIST_FOLDER,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });

    it('should block update note operations targeting the internal data directory without an explicit extension', async () => {
        const args = {
            content: 'update',
            mode: 'append',
            path: '.vault-intelligence/secret',
        };
        const result = await toolRegistry.execute({
            args,
            createdFiles: new Set(),
            name: AGENT_CONSTANTS.TOOLS.UPDATE_NOTE,
            usedFiles: new Set(),
        });
        if ('error' in result) {
            expect(result.error as string).toContain('Permission Denied');
        } else {
            throw new Error('Expected error but got result');
        }
    });
});
