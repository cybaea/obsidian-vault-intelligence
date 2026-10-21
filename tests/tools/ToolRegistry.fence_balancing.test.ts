import { App, requestUrl } from 'obsidian';
import { Mock, Mocked, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Replace only requestUrl: `read_url` needs a controllable fetch response
// while the remaining real obsidian mock (TFile, App, normalizePath, ...)
// stays intact (precedent: tests/settings/connection-fields.test.ts).
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mocks/obsidian')>();
    return { ...actual, requestUrl: vi.fn() };
});

describe('ToolRegistry fence balancing', () => {
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockProvider: Mocked<IModelProvider> & { searchWithGrounding: Mock };
    let mockGraphService: GraphService;
    let mockSearchOrchestrator: SearchOrchestrator;
    let mockContextAssembler: ContextAssembler;
    let mockFileTools: FileTools;
    let mockMcpClientManager: McpClientManager;

    beforeEach(() => {
        (requestUrl as Mock).mockReset();

        mockApp = {} as unknown as App;
        mockSettings = {
            allowLocalNetworkAccess: false,
            mcpServers: []
        } as unknown as VaultIntelligenceSettings;

        // The provider doubles as the reasoning client (as in the capabilities
        // suite), so searchWithGrounding - an IReasoningClient method - is
        // mocked on this object and the real dispatch path is exercised.
        mockProvider = {
            initialize: vi.fn(),
            searchWithGrounding: vi.fn(),
            supportsStructuredOutput: true,
            supportsTools: true,
            supportsWebGrounding: true,
            terminate: vi.fn()
        } as unknown as Mocked<IModelProvider> & { searchWithGrounding: Mock };
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

    // `execute` wraps dispatch in try/catch and returns `{ error: ... }` on
    // failure, so guard with the discriminated union before asserting the
    // result (style of tests/ToolRegistry.path_traversal.test.ts).
    const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const registry = createRegistry(mockProvider);
        const response = await registry.execute({
            args,
            createdFiles: new Set(),
            name,
            usedFiles: new Set()
        });
        if ('error' in response) throw new Error(`Unexpected error: ${response.error as string}`);
        return response.result as string;
    };

    /**
     * Standalone fence pairing: every fence opened by a line of at least
     * three markers must be closed by a matching closer line within the
     * same excerpt. Copied verbatim from tests/utils/indexer-utils.test.ts
     * so the tool-result assertions verify balance exactly like the
     * augmentation utilities' own suite does.
     */
    const isBalanced = (excerpt: string): boolean => {
        let openChar = '\0';
        let openLength = 0;
        for (const rawLine of excerpt.split('\n')) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            let indent = 0;
            while (indent < 3 && line.charAt(indent) === ' ') indent++;
            const first = line.charAt(indent);
            if (first !== '`' && first !== '~') continue;

            let run = 0;
            while (line.charAt(indent + run) === first) run++;
            if (run < 3) continue;
            if (openChar === '\0') {
                openChar = first;
                openLength = run;
            } else if (first === openChar && run >= openLength) {
                openChar = '\0';
                openLength = 0;
            }
        }
        return openChar === '\0';
    };

    describe('read_url', () => {
        const readUrl = async (text: string): Promise<string> => {
            (requestUrl as Mock).mockResolvedValue({ text });
            return await executeTool(AGENT_CONSTANTS.TOOLS.URL_READER, { url: 'https://example.com/doc' });
        };

        it('should balance a short fetch whose code fence stays open', async () => {
            const shortUnclosed = 'Intro\n```python\nprint(1)';
            const result = await readUrl(shortUnclosed);
            expect(result).toBe(shortUnclosed + '\n```\n');
            expect(isBalanced(result)).toBe(true);
        });

        it('should return a fenceless fetch byte-identical', async () => {
            const shortPlain = 'Just text.\nNo fences.';
            const result = await readUrl(shortPlain);
            expect(result).toBe(shortPlain);
            expect(isBalanced(result)).toBe(true);
        });

        it('should balance a fence still open at the 5000-character cut', async () => {
            const openAtCut = 'a'.repeat(4000) + '\n```python\nx = 1\n' + 'b'.repeat(2000);
            const result = await readUrl(openAtCut);
            expect(result).toBe(openAtCut.substring(0, 5000) + '\n```\n');
            expect(isBalanced(result)).toBe(true);
        });

        it('should derive a four-marker closer from the full payload when the opener is cut mid-run', async () => {
            // The decisive full-text-scan regression test: the opener starts at
            // 4997 with three of its four markers visible at the cut, so a
            // slice-only scan would see a three-backtick run and emit an
            // ineffective three-backtick closer.
            const quadrupleAtCut = 'a'.repeat(4996) + '\n' + '````python\nx = 1\n' + 'b'.repeat(2000);
            const result = await readUrl(quadrupleAtCut);
            expect(result).toBe(quadrupleAtCut.substring(0, 5000) + '\n````\n');
            expect(isBalanced(result)).toBe(true);
        });

        it('should leave a sub-marker remnant at the cut untouched', async () => {
            // The opener starts at 4998 with only two markers visible: a
            // remnant shorter than three markers opens no fence, so the
            // fragment is already inert and gets no closer by design.
            const remnantAtCut = 'a'.repeat(4997) + '\n' + '````python\nx = 1\n' + 'b'.repeat(2000);
            const result = await readUrl(remnantAtCut);
            expect(result).toBe(remnantAtCut.substring(0, 5000));
            expect(isBalanced(result)).toBe(true);
        });

        it('should return an already-balanced fetch byte-identical', async () => {
            // The real closer lies fully inside the slice, so no augmentation.
            const balancedLong = 'a'.repeat(100) + '\n```js\ncode\n```\n' + 'b'.repeat(6000);
            const result = await readUrl(balancedLong);
            expect(result).toBe(balancedLong.substring(0, 5000));
            expect(isBalanced(result)).toBe(true);
        });

        it('should return an empty fetch byte-identical', async () => {
            expect(await readUrl('')).toBe('');
        });
    });

    describe('google_search', () => {
        const search = async (text: string): Promise<string> => {
            mockProvider.searchWithGrounding.mockResolvedValue({ text });
            return await executeTool(AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH, { query: 'test' });
        };

        it('should balance grounding text whose code fence stays open', async () => {
            const grounded = 'Answer\n```js\nconst x';
            const result = await search(grounded);
            expect(result).toBe(grounded + '\n```\n');
            expect(isBalanced(result)).toBe(true);
        });

        it('should return fenceless grounding text byte-identical', async () => {
            const result = await search('Plain answer.');
            expect(result).toBe('Plain answer.');
            expect(isBalanced(result)).toBe(true);
        });

        it('should return empty grounding text byte-identical', async () => {
            expect(await search('')).toBe('');
        });
    });
});