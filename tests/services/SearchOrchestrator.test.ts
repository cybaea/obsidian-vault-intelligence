/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking complex internal objects */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking complex internal objects */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking complex internal objects */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking complex internal objects */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking complex internal objects */
/* eslint-disable @typescript-eslint/unbound-method -- Mocking complex internal objects */
import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchOrchestrator } from '../../src/services/SearchOrchestrator';
import { VaultIntelligenceSettings } from '../../src/settings/types';

describe('SearchOrchestrator', () => {
    let app: App;
    let graphService: any;
    let reasoningClient: any;
    let embeddingService: any;
    let settings: VaultIntelligenceSettings;
    let orchestrator: SearchOrchestrator;

    beforeEach(() => {
        app = {} as App;
        graphService = {
            buildPriorityPayload: vi.fn(),
            keywordSearch: vi.fn(),
            search: vi.fn()
        };
        reasoningClient = {
            generateStructured: vi.fn()
        };
        embeddingService = {
            embedQuery: vi.fn()
        };
        settings = {
            enableDualLoop: true,
            keywordWeight: 1.2,
            minSimilarityScore: 0.5,
            vaultSearchResultsLimit: 10
        } as any;

        orchestrator = new SearchOrchestrator(
            app,
            graphService,
            reasoningClient,
            embeddingService,
            settings
        );
    });

    describe('searchReflex (Loop 1)', () => {
        it('should correctly merge and rank results with sigmoid calibration', async () => {
            // Mock vector results (scores are naturally [0, 1])
            graphService.search.mockResolvedValue([
                { excerpt: 'vector1', path: 'doc1.md', score: 0.8 },
                { excerpt: 'vector2', path: 'doc2.md', score: 0.4 }
            ]);

            // Mock keyword results (scores are BM25, can be > 1.0)
            // Normalized score = score / (score + K) where K = keywordWeight (1.2)
            // doc2 (bm25 1.2) -> 1.2 / (1.2 + 1.2) = 0.5
            // doc3 (bm25 3.6) -> 3.6 / (3.6 + 1.2) = 0.75
            graphService.keywordSearch.mockResolvedValue([
                { excerpt: 'keyword2', path: 'doc2.md', score: 1.2 },
                { excerpt: 'keyword3', path: 'doc3.md', score: 3.6 }
            ]);

            const results = await orchestrator.searchReflex('test', 10);

            // doc1: only vector (0.8)
            // doc2: vector(0.4) + keyword(0.5) = (0.4 + 0.5)/1.5 = 0.6
            // doc3: only keyword (0.75)
            
            expect(results).toHaveLength(3);
            expect(results[0]!.path).toBe('doc1.md');
            expect(results[0]!.score).toBeCloseTo(0.8);
            
            expect(results[1]!.path).toBe('doc3.md');
            expect(results[1]!.score).toBeCloseTo(0.75);
            
            expect(results[2]!.path).toBe('doc2.md');
            expect(results[2]!.score).toBeCloseTo(0.6);
        });

        it('should filter results below minSimilarityScore', async () => {
             graphService.search.mockResolvedValue([
                { path: 'good.md', score: 0.9 },
                { path: 'bad.md', score: 0.1 }
            ]);
            graphService.keywordSearch.mockResolvedValue([]);

            const results = await orchestrator.searchReflex('test', 10);
            expect(results).toHaveLength(1);
            expect(results[0]!.path).toBe('good.md');
        });
    });

    describe('searchAnalyst (Loop 2)', () => {
        it('should respect enableDualLoop setting', async () => {
            settings.enableDualLoop = false;
            const results = await orchestrator.searchAnalyst('test query');
            expect(results).toEqual([]);
            expect(embeddingService.embedQuery).not.toHaveBeenCalled();
        });

        it('should invoke reasoning client when dual loop is enabled', async () => {
            embeddingService.embedQuery.mockResolvedValue({ vector: [0.1, 0.2] });
            graphService.buildPriorityPayload.mockResolvedValue({ context: 'some context' });
            reasoningClient.generateStructured.mockResolvedValue([
                { id: 'analyst1.md', reasoning: 'matches well', score: 0.95 }
            ]);

            const results = await orchestrator.searchAnalyst('advanced query');
            
            expect(results).toHaveLength(1);
            expect(results[0]!.path).toBe('analyst1.md');
            expect(results[0]!.score).toBe(0.95);
            expect(reasoningClient.generateStructured).toHaveBeenCalled();
        });
    });

    describe('search (Primary Entry)', () => {
        it('should prefer deep search if requested and available', async () => {
             // Mock analyst returning something
             vi.spyOn(orchestrator, 'searchAnalyst').mockResolvedValue([{ path: 'deep.md', score: 0.99 }]);
             vi.spyOn(orchestrator, 'searchReflex');

             const results = await orchestrator.search('query', 5, { deep: true });
             
             expect(results[0]!.path).toBe('deep.md');
             expect(orchestrator.searchReflex).not.toHaveBeenCalled();
        });

        it('should fallback to reflex if analyst returns no results', async () => {
            vi.spyOn(orchestrator, 'searchAnalyst').mockResolvedValue([]);
            vi.spyOn(orchestrator, 'searchReflex').mockResolvedValue([{ path: 'reflex.md', score: 0.5 }]);

            const results = await orchestrator.search('query', 5, { deep: true });
            
            expect(results[0]!.path).toBe('reflex.md');
            expect(orchestrator.searchReflex).toHaveBeenCalled();
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-argument -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/unbound-method -- End of mock-heavy test section */
