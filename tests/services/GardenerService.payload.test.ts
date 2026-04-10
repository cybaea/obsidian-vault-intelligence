/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GardenerService } from '../../src/services/GardenerService';
import { GardenerStateService } from '../../src/services/GardenerStateService';
import { GraphService } from '../../src/services/GraphService';
import { OntologyService } from '../../src/services/OntologyService';
import { ProviderRegistry } from '../../src/services/ProviderRegistry';
import { VaultIntelligenceSettings } from '../../src/settings/types';
import { IReasoningClient } from '../../src/types/providers';

describe('GardenerService Payload and Budgeting', () => {
    let gardenerService: GardenerService;
    let mockApp: App;
    let mockProviderRegistry: ProviderRegistry;
    let mockOntology: OntologyService;
    let mockState: GardenerStateService;
    let mockGraphService: GraphService;
    let mockSettings: VaultIntelligenceSettings;
    let mockReasoningClient: IReasoningClient;

    beforeEach(() => {
        mockApp = {
            fileManager: {
                trashFile: vi.fn().mockResolvedValue(undefined),
            },
            metadataCache: {
                getFileCache: vi.fn().mockReturnValue({ frontmatter: {} }),
            },
            vault: {
                cachedRead: vi.fn().mockResolvedValue(''),
                // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
                create: vi.fn().mockResolvedValue({ path: 'plan.md' } as unknown as TFile),
                createFolder: vi.fn().mockResolvedValue(undefined),
                getAbstractFileByPath: vi.fn().mockReturnValue(null),
                getMarkdownFiles: vi.fn().mockReturnValue([]),
                modify: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as App;

        mockReasoningClient = {
            generateStructured: vi.fn().mockResolvedValue({
                actions: [],
                date: '2026-04-10',
                summary: 'Test summary'
            }),
        } as unknown as IReasoningClient;

        mockProviderRegistry = {
            getReasoningClient: vi.fn().mockReturnValue(mockReasoningClient),
        } as unknown as ProviderRegistry;

        mockOntology = {
            getOntologyContext: vi.fn().mockResolvedValue({ folders: {}, instructions: '' }),
            getValidTopics: vi.fn().mockResolvedValue([]),
            validateTopic: vi.fn().mockReturnValue(true),
        } as unknown as OntologyService;

        mockState = {
            recordCheck: vi.fn().mockResolvedValue(undefined),
            recordCheckBatch: vi.fn().mockResolvedValue(undefined),
            shouldProcess: vi.fn().mockReturnValue(true),
        } as unknown as GardenerStateService;

        mockGraphService = {
            getOntologySynonyms: vi.fn().mockResolvedValue([]),
            getOrphanCandidates: vi.fn().mockResolvedValue([]),
        } as unknown as GraphService;

        mockSettings = {
            excludedFolders: [],
            gardenerContextBudget: 1000,
            gardenerModel: 'test-model',
            gardenerNoteLimit: 10,
            gardenerOrphanGracePeriodDays: 7,
            gardenerPlansPath: 'Gardener/Plans',
            gardenerRecheckDays: 1,
            gardenerSkipRetentionDays: 7,
            modelContextOverrides: {},
            ontologyPath: 'Ontology',
        } as unknown as VaultIntelligenceSettings;

        gardenerService = new GardenerService(
            mockApp,
            mockProviderRegistry,
            mockOntology,
            mockSettings,
            mockState,
            mockGraphService
        );
    });

    it('should include file content in the payload sent to the LLM using compact JSON', async () => {
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
        const mockFile = { path: 'note.md', stat: { mtime: 100, size: 100 } } as unknown as TFile;
        (mockApp.vault.getMarkdownFiles as any).mockReturnValue([mockFile]);
        (mockApp.vault.cachedRead as any).mockResolvedValue('Note content with "quotes" and \n newlines.');
        (mockApp.metadataCache.getFileCache as any).mockReturnValue({
            frontmatter: { topics: ['Topic A'] }
        });

        // Increase budget to accommodate new overhead and safety margin
        mockSettings.gardenerContextBudget = 5000;
        await gardenerService.tidyVault();

        await vi.waitFor(() => {
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock access is safe
            expect(mockReasoningClient.generateStructured).toHaveBeenCalled();
        }, { timeout: 1000 });

        const [messages] = (mockReasoningClient.generateStructured as any).mock.calls[0];
        const prompt = messages[0].content;

        // Verify compact JSON: no newlines/indentation between fields
        expect(prompt).toContain('{"content":"Note content with \\"quotes\\" and \\n newlines.","path":"note.md","topics":["Topic A"]}');
    });

    it('should respect the context budget using JSON-serialized size', async () => {
        const content1 = 'A'.repeat(500);
        const content2 = 'B'.repeat(500);
        
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
        const file1 = { path: 'file1.md', stat: { mtime: 200, size: 500 } } as unknown as TFile;
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mocking TFile for tests
        const file2 = { path: 'file2.md', stat: { mtime: 100, size: 500 } } as unknown as TFile;
        
        (mockApp.vault.getMarkdownFiles as any).mockReturnValue([file1, file2]);
        (mockApp.vault.cachedRead as any).mockImplementation((file: TFile) => {
            if (file.path === 'file1.md') return Promise.resolve(content1);
            if (file.path === 'file2.md') return Promise.resolve(content2);
            return Promise.resolve('');
        });

        // charsPerToken is now 3.0 in the implementation.
        // basePromptEstimate = (0 + 0 + 0 + 5000) / 3.0 = ~1667 tokens.
        // safetyMargin is 0.8.
        
        // file1 JSON is ~550 chars => ~183 tokens.
        // file2 JSON is ~550 chars => ~183 tokens.
        
        // Let's set budget so only file1 fits:
        // Try raw budget = 2350.
        // 2350 * 0.8 = 1880 tokens available.
        // base (1667) + file1 (183) = 1850. (OK)
        // 1850 + file2 (183) = 2033. (EXCEEDS 1880)
        mockSettings.gardenerContextBudget = 2350;
        
        await gardenerService.tidyVault();

        await vi.waitFor(() => {
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock access is safe
            expect(mockReasoningClient.generateStructured).toHaveBeenCalled();
        }, { timeout: 1000 });

        const [messages] = (mockReasoningClient.generateStructured as any).mock.calls[0];
        const prompt = messages[0].content;
        
        const notesSection = prompt.split('NOTES:\n')[1];
        const notes = JSON.parse(notesSection);
        
        expect(notes.length).toBe(1);
        expect(notes[0].path).toBe('file1.md');
    });
});
