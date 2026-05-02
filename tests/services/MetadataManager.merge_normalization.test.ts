import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { MetadataManager } from '../../src/services/MetadataManager';

interface MockApp {
    fileManager: {
        processFrontMatter: Mock;
    };
    metadataCache: {
        getFileCache: Mock;
        getFirstLinkpathDest: Mock;
    };
    vault: {
        cachedRead: Mock;
        getAbstractFileByPath: Mock;
        modify: Mock;
        processFrontMatter: Mock;
    };
}

describe('MetadataManager - Merge Normalization', () => {
    let mockApp: MockApp;
    let metadataManager: MetadataManager;

    beforeEach(() => {
        mockApp = {
            fileManager: {
                processFrontMatter: vi.fn()
            },
            metadataCache: {
                getFileCache: vi.fn(),
                getFirstLinkpathDest: vi.fn()
            },
            vault: {
                cachedRead: vi.fn(),
                getAbstractFileByPath: vi.fn(),
                modify: vi.fn(),
                processFrontMatter: vi.fn()
            }
        };
        metadataManager = new MetadataManager(mockApp as unknown as App);
    });

    describe('replaceLinksAsync with de-duplication', () => {
        it('should de-duplicate topics in frontmatter when merging', async () => {
            const neighborPath = 'Testing the cloud.md';
            const sourceTopic = 'Ontology/Concepts/Cloud Infrastructure.md';
            const targetTopic = 'Ontology/Concepts/Cloud Computing.md';
            const mockFile = Object.assign(new TFile(), { path: neighborPath });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            
            // Mock cache with frontmatterLinks for robust resolution
            mockApp.metadataCache.getFileCache.mockReturnValue({
                frontmatter: {
                    topics: [
                        "[Cloud Computing](/Ontology/Concepts/Cloud%20Computing.md)",
                        "[[Ontology/Concepts/Cloud Computing|Cloud Infrastructure]]"
                    ]
                },
                // Intentionally omit frontmatterLinks for the Markdown one to test the regex fallback
                frontmatterLinks: [
                    {
                        key: "topics",
                        link: "Ontology/Concepts/Cloud Computing|Cloud Infrastructure",
                        original: "[[Ontology/Concepts/Cloud Computing|Cloud Infrastructure]]"
                    }
                ],
                links: [] 
            });

            // Mock resolution
            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) => {
                // Should correctly resolve the Markdown path from regex extractor
                if (path.includes('Cloud Computing') || path === '/Ontology/Concepts/Cloud Computing.md' || path === 'Ontology/Concepts/Cloud Computing.md') {
                    return { path: 'Ontology/Concepts/Cloud Computing.md' };
                }
                return null;
            });

            // Mock processFrontMatter call
            const frontmatter = {
                topics: [
                    "[Cloud Computing](/Ontology/Concepts/Cloud%20Computing.md)",
                    "[[Ontology/Concepts/Cloud Computing|Cloud Infrastructure]]"
                ] as string[]
            };
            mockApp.fileManager.processFrontMatter.mockImplementation((_file: TFile, cb: (fm: Record<string, unknown>) => void) => {
                cb(frontmatter);
            });

            await metadataManager.replaceLinksAsync([neighborPath], sourceTopic, targetTopic);

            // Expect frontmatter to be updated and de-duplicated
            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
            // Both resolve to same target, so collapsed to 1 canonical wikilink
            expect(frontmatter.topics.length).toBe(1);
            expect(frontmatter.topics[0]).toBe("[[Ontology/Concepts/Cloud Computing]]");
        });

        it('should convert source link to target with alias and de-duplicate', async () => {
            const neighborPath = 'Note.md';
            const sourceTopic = 'Old.md';
            const targetTopic = 'New.md';
            const mockFile = Object.assign(new TFile(), { path: neighborPath });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.metadataCache.getFileCache.mockReturnValue({
                frontmatter: {
                    topics: ["[[Old]]", "[[New]]"]
                },
                frontmatterLinks: [
                    { key: "topics", link: "Old", original: "[[Old]]" },
                    { key: "topics", link: "New", original: "[[New]]" }
                ],
                links: []
            });

            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) => {
                if (path === 'Old') return { path: 'Old.md' };
                if (path === 'New') return { path: 'New.md' };
                return null;
            });

            const frontmatter = { topics: ["[[Old]]", "[[New]]"] as string[] };
            mockApp.fileManager.processFrontMatter.mockImplementation((_file: TFile, cb: (fm: Record<string, unknown>) => void) => {
                cb(frontmatter);
            });

            await metadataManager.replaceLinksAsync([neighborPath], sourceTopic, targetTopic);

            // Collapsed because Old becomes New
            expect(frontmatter.topics.length).toBe(1);
            expect(frontmatter.topics[0]).toBe("[[New|Old]]");
        });

        it('should handle body links using native parsing', async () => {
            const neighborPath = 'BodyNote.md';
            const sourceTopic = 'OldBody.md';
            const targetTopic = 'NewBody.md';
            const mockFile = Object.assign(new TFile(), { path: neighborPath });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            
            // Link in body
            const mockLink = {
                link: 'OldBody',
                position: {
                    end: { offset: 22 },
                    start: { offset: 11 }
                }
            };

            mockApp.metadataCache.getFileCache.mockReturnValue({
                links: [mockLink]
            });

            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) => {
                if (path === 'OldBody') return { path: 'OldBody.md' };
                return null;
            });

            const originalContent = "Check this [[OldBody]] note.";
            mockApp.vault.cachedRead.mockResolvedValue(originalContent);

            await metadataManager.replaceLinksAsync([neighborPath], sourceTopic, targetTopic);

            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                "Check this [[NewBody|OldBody]] note."
            );
        });
    });
});
