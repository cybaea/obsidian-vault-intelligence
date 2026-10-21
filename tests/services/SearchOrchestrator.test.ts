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
            expect(results[0]?.path).toBe('doc1.md');
            expect(results[0]?.score).toBeCloseTo(0.8);
            
            expect(results[1]?.path).toBe('doc3.md');
            expect(results[1]?.score).toBeCloseTo(0.75);
            
            expect(results[2]?.path).toBe('doc2.md');
            expect(results[2]?.score).toBeCloseTo(0.6);
        });

        it('should filter results below minSimilarityScore', async () => {
             graphService.search.mockResolvedValue([
                { path: 'good.md', score: 0.9 },
                { path: 'bad.md', score: 0.1 }
            ]);
            graphService.keywordSearch.mockResolvedValue([]);

            const results = await orchestrator.searchReflex('test', 10);
            expect(results).toHaveLength(1);
            expect(results[0]?.path).toBe('good.md');
        });
    });

    describe('hybrid ranking semantics (ADR-005, ADR-011)', () => {
        it('preserves hybrid preference, vector trust, and score values for dual/vector/keyword evidence', async () => {
            // Vector input mirrors the indexer worker's early-fusion output:
            // cosine similarity (max 1.0) plus 0.5 * locally-normalised keyword
            // bonus for documents that also matched keywords -> ceiling 1.5.
            graphService.search.mockResolvedValue([
                { excerpt: 'dual signal', path: 'dual.md', score: 1.5 },
                { excerpt: 'vector only', path: 'vector.md', score: 0.95 }
            ]);

            // Raw BM25 scores from the keyword path (unbounded).
            graphService.keywordSearch.mockResolvedValue([
                { excerpt: 'keyword only', path: 'keyword.md', score: 6.0 },
                { excerpt: 'dual signal', path: 'dual.md', score: 6.0 }
            ]);

            const results = await orchestrator.searchReflex('evidence query', 10);

            // Keyword sigmoids (K = 1.2): 6 / (6 + 1.2) = 0.8333
            // dual.md:    (1.5 + 0.8333) / 1.5 = 1.5556
            // vector.md:  0.95
            // keyword.md: 0.8333
            expect(results).toHaveLength(3);

            // ADR-005 (hybrid preference): a dual match outranks pure matches...
            expect(results[0]?.path).toBe('dual.md');
            // ...even when its vector input exceeds 1.0 (worker early fusion).
            expect(results[0]?.score).toBeCloseTo(1.5556, 4);

            // The divider (1.5) encodes vector trust: with equal raw keyword
            // evidence, the vector-only result outranks the keyword-only result.
            expect(results[1]?.path).toBe('vector.md');
            expect(results[1]?.score).toBeCloseTo(0.95, 4);

            expect(results[2]?.path).toBe('keyword.md');
            expect(results[2]?.score).toBeCloseTo(0.8333, 4);

            // ADR-011 (deep recall + post-filter): all three evidence classes
            // survive the absolute minSimilarityScore floor (0.5).
            for (const r of results) {
                expect(r.score).toBeGreaterThanOrEqual(0.5);
            }
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
            expect(results[0]?.path).toBe('analyst1.md');
            expect(results[0]?.score).toBe(0.95);
            expect(reasoningClient.generateStructured).toHaveBeenCalled();
        });

        it('should embed the re-rank payload as escaped JSON even when content holds an unclosed fence (safe-path guard)', async () => {
            embeddingService.embedQuery.mockResolvedValue({ vector: [0.1, 0.2] });
            const payload = [{ content: '```python\nunclosed code', path: 'fenced.md', score: 0.9 }];
            graphService.buildPriorityPayload.mockResolvedValue(payload);
            reasoningClient.generateStructured.mockResolvedValue([]);

            await orchestrator.searchAnalyst('fenced query');

            const options = reasoningClient.generateStructured.mock.calls[0][2];
            expect(options.systemInstruction).toContain(`Document Context:\n${JSON.stringify(payload)}`);
        });
    });

    describe('search (Primary Entry)', () => {
        it('should prefer deep search if requested and available', async () => {
             // Mock analyst returning something
             vi.spyOn(orchestrator, 'searchAnalyst').mockResolvedValue([{ path: 'deep.md', score: 0.99 }]);
             vi.spyOn(orchestrator, 'searchReflex');

             const results = await orchestrator.search('query', 5, { deep: true });
             
             expect(results[0]?.path).toBe('deep.md');
             expect(orchestrator.searchReflex).not.toHaveBeenCalled();
        });

        it('should fallback to reflex if analyst returns no results', async () => {
            vi.spyOn(orchestrator, 'searchAnalyst').mockResolvedValue([]);
            vi.spyOn(orchestrator, 'searchReflex').mockResolvedValue([{ path: 'reflex.md', score: 0.5 }]);

            const results = await orchestrator.search('query', 5, { deep: true });
            
            expect(results[0]?.path).toBe('reflex.md');
            expect(orchestrator.searchReflex).toHaveBeenCalled();
        });
    });
});

