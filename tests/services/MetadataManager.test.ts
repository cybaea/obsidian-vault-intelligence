import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { MetadataManager } from '../../src/services/MetadataManager';

interface MockApp {
    metadataCache: {
        getFileCache: Mock;
        getFirstLinkpathDest: Mock;
    };
    vault: {
        cachedRead: Mock;
        getAbstractFileByPath: Mock;
        modify: Mock;
    };
}

describe('MetadataManager', () => {
    let mockApp: MockApp;
    let metadataManager: MetadataManager;

    beforeEach(() => {
        mockApp = {
            metadataCache: {
                getFileCache: vi.fn(),
                getFirstLinkpathDest: vi.fn()
            },
            vault: {
                cachedRead: vi.fn(),
                getAbstractFileByPath: vi.fn(),
                modify: vi.fn()
            }
        };
        metadataManager = new MetadataManager(mockApp as unknown as App);
    });

    describe('replaceLinksAsync', () => {
        it('should correctly splice links using AST offsets and retain custom aliases', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'neighbor.md' });
            const sourceTopic = 'Ontology/ConceptA';
            const targetTopic = 'Ontology/ConceptB';

            const originalContent = "This is a [[Ontology/ConceptA|custom alias]] link and a regular [[Ontology/ConceptA]] link.";

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.metadataCache.getFileCache.mockReturnValue({
                links: [
                    {
                        displayText: 'custom alias',
                        link: 'Ontology/ConceptA',
                        position: { end: { offset: 44 }, start: { offset: 10 } }
                    },
                    {
                        displayText: 'Ontology/ConceptA',
                        link: 'Ontology/ConceptA',
                        position: { end: { offset: 85 }, start: { offset: 64 } }
                    }
                ]
            });
            mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
            mockApp.vault.cachedRead.mockResolvedValue(originalContent);

            await metadataManager.replaceLinksAsync(['neighbor.md'], sourceTopic, targetTopic);

            expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);
            
            const expectedContent = "This is a [[Ontology/ConceptB|custom alias]] link and a regular [[Ontology/ConceptB|ConceptA]] link.";
            expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
        });

        it('should handle implicit alias (extracting from link bracket notation)', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'neighbor.md' });
            const sourceTopic = 'Ontology/ConceptA';
            const targetTopic = 'Ontology/ConceptB';

            const originalContent = "Here: [[Ontology/ConceptA|SneakyAlias]] is cool.";

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.metadataCache.getFileCache.mockReturnValue({
                links: [
                    {
                        displayText: 'Ontology/ConceptA', // Obsidian sometimes fails to parse display text correctly
                        link: 'Ontology/ConceptA',
                        position: { end: { offset: 39 }, start: { offset: 6 } }
                    }
                ]
            });
            mockApp.vault.cachedRead.mockResolvedValue(originalContent);

            await metadataManager.replaceLinksAsync(['neighbor.md'], sourceTopic, targetTopic);

            const expectedContent = "Here: [[Ontology/ConceptB|SneakyAlias]] is cool.";
            expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
        });

        it('should do nothing if no links match the source topic', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'neighbor.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.metadataCache.getFileCache.mockReturnValue({
                links: [
                    {
                        link: 'Ontology/OtherConcept',
                        position: { end: { offset: 10 }, start: { offset: 0 } }
                    }
                ]
            });

            await metadataManager.replaceLinksAsync(['neighbor.md'], 'Ontology/ConceptA', 'Ontology/ConceptB');

            expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();
            expect(mockApp.vault.modify).not.toHaveBeenCalled();
        });
    });
});
