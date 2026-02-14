import { App } from 'obsidian';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { AGENT_CONSTANTS } from '../src/constants';
import { ContextAssembler } from '../src/services/ContextAssembler';
import { GeminiService } from '../src/services/GeminiService';
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
    let mockGemini: GeminiService;
    let mockGraph: GraphService;
    let mockSearch: SearchOrchestrator;
    let mockContext: ContextAssembler;
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
            excludedFolders: ['Secret', 'Private/Confidential', 'Secret/Financials.md'],
            vaultSearchResultsLimit: 10,
        } as unknown as VaultIntelligenceSettings;

        mockGemini = {} as unknown as GeminiService;
        mockGraph = {} as unknown as GraphService;
        mockSearch = {} as unknown as SearchOrchestrator;
        mockContext = {} as unknown as ContextAssembler;
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
            mockGemini,
            mockGraph,
            mockSearch,
            mockContext,
            mockFileTools
        );
    });

    it('should block path traversal bypass (Test Case 1)', async () => {
        const args = {
            content: 'hacked',
            path: 'Allowed/../Secret/stolen.md',
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

    it('should block rename destination bypass (Test Case 2)', async () => {
        const args = {
            newPath: 'Secret/note.md',
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

    it('should block rename source bypass (Test Case 3)', async () => {
        const args = {
            newPath: 'Public/note.md',
            path: 'Secret/note.md',
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

    it('should block read bypass (Test Case 4)', async () => {
        const args = { path: 'Secret/note.md' };
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

    it('should block list bypass (Test Case 5)', async () => {
        const args = { folderPath: 'Secret' };
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

    it('should block extension bypass (Test Case 6)', async () => {
        // Excluded: 'Secret/Financials.md'
        const args = {
            content: 'update',
            mode: 'append',
            path: 'Secret/Financials',
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
