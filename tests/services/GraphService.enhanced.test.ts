/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { Plugin } from 'obsidian';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GRAPH_CONSTANTS } from '../../src/constants';
import { GraphService } from '../../src/services/GraphService';
import { GraphSearchResult } from '../../src/types/graph';

// Mock dependencies
const mockPlugin = {
    app: {
        vault: {
            getAbstractFileByPath: vi.fn()
        }
    },
    settings: {
        similarNotesLimit: 10
    }
} as unknown as Plugin;

const mockVaultManager = {} as any;
const mockGeminiService = {} as any;
const mockEmbeddingService = {} as any;
const mockPersistenceManager = {} as any;
const mockSettings = {
    minSimilarityScore: 0.5,
    similarNotesLimit: 10
} as any;

describe('GraphService.getGraphEnhancedSimilar', () => {
    let graphService: GraphService;
    const weights = GRAPH_CONSTANTS.ENHANCED_SIMILAR_WEIGHTS;

    beforeEach(() => {
        graphService = new GraphService(
            mockPlugin,
            mockVaultManager,
            mockGeminiService,
            mockEmbeddingService,
            mockPersistenceManager,
            mockSettings
        );

        // Mock internal methods
        graphService.getSimilar = vi.fn();
        graphService.getNeighbors = vi.fn();

        // Inject mock hydrator
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Mocking internal service */
        (graphService as any).hydrator = {
            hydrate: vi.fn().mockImplementation((results) => Promise.resolve({
                driftDetected: [],
                hydrated: results
            }))
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should apply multiplicative boost when a file is both a vector match and a neighbor', async () => {
        const filePath = 'source.md';

        // Mock Vector Results (Content match)
        const vectorResults: GraphSearchResult[] = [
            { path: 'hybrid.md', score: 0.8 } as GraphSearchResult
        ];

        // Mock Neighbor Results (Graph connection)
        const neighborResults: GraphSearchResult[] = [
            { path: 'hybrid.md', score: 0.5 } as GraphSearchResult
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('hybrid.md');

        // Expected Score: 0.8 * 1.15 = 0.92
        expect(results[0]!.score).toBeCloseTo(0.92);
        expect(results[0]!.description).toBe("(Enhanced semantic connection)");
    });

    it('should cap boosted scores at 1.0', async () => {
        const filePath = 'source.md';

        const vectorResults: GraphSearchResult[] = [
            { path: 'hybrid-top.md', score: 0.95 } as GraphSearchResult
        ];

        const neighborResults: GraphSearchResult[] = [
            { path: 'hybrid-top.md', score: 0.5 } as GraphSearchResult
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        // Expected: min(1.0, 0.95 * 1.15) = 1.0
        expect(results[0]!.score).toBe(1.0);
    });

    it('should append pure neighbors as anchors at the bottom with hydration', async () => {
        const filePath = 'source.md';
        const minScore = 0.5;

        // Vector returns something else
        const vectorResults: GraphSearchResult[] = [
            { path: 'vector-only.md', score: 0.8 } as GraphSearchResult
        ];

        // Neighbor returns a sibling not in vectors
        const neighborResults: GraphSearchResult[] = [
            { path: 'pure-neighbor.md', score: 0.3 } as GraphSearchResult
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        // Mock hydrator to ensure it was called for the anchor
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Mocking internal service */
        const hydrateSpy = vi.spyOn((graphService as any).hydrator, 'hydrate');

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results).toHaveLength(2);

        // Pure neighbor should be at the bottom
        const anchor = results.find(r => r.path === 'pure-neighbor.md');
        expect(anchor).toBeDefined();

        // Expected Score: minScore - 0.01 = 0.49
        expect(anchor!.score).toBe(minScore - 0.01);
        expect(anchor!.description).toBe("(Structural neighbor)");

        // Verify hydrator was called for the anchor
        expect(hydrateSpy).toHaveBeenCalled();
        const callArgs = hydrateSpy.mock.calls[0]![0] as GraphSearchResult[];
        expect(callArgs.some(r => r.path === 'pure-neighbor.md')).toBe(true);
    });

    it('should respect MAX_PURE_NEIGHBORS cap', async () => {
        const filePath = 'source.md';

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue([]);

        // Return 5 neighbors, cap is 3
        const neighborResults: GraphSearchResult[] = [
            { path: 'n1.md', score: 0.5 },
            { path: 'n2.md', score: 0.4 },
            { path: 'n3.md', score: 0.3 },
            { path: 'n4.md', score: 0.2 },
            { path: 'n5.md', score: 0.1 }
        ] as GraphSearchResult[];

        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        // Cap is 3
        expect(results).toHaveLength(weights.MAX_PURE_NEIGHBORS);
        // Should take the top 3 by neighbor score
        expect(results.map(r => r.path)).toContain('n1.md');
        expect(results.map(r => r.path)).toContain('n2.md');
        expect(results.map(r => r.path)).toContain('n3.md');
    });

    it('should exclude the source file itself from all sources', async () => {
        const filePath = 'source.md';

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue([{ path: filePath, score: 1.0 } as GraphSearchResult]);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue([{ path: filePath, score: 0.5 } as GraphSearchResult]);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);
        expect(results.some(r => r.path === filePath)).toBe(false);
    });

    it('should prioritize hybrid matches over vector matches if boosted score is higher', async () => {
        const filePath = 'source.md';

        // Vector match A: 0.9 (pure)
        // Vector match B: 0.8 (hybrid) -> 0.8 * 1.15 = 0.92
        const vectorResults: GraphSearchResult[] = [
            { path: 'pure-vector.md', score: 0.9 } as GraphSearchResult,
            { path: 'hybrid.md', score: 0.8 } as GraphSearchResult
        ];

        const neighborResults: GraphSearchResult[] = [
            { path: 'hybrid.md', score: 0.5 } as GraphSearchResult
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results[0]!.path).toBe('hybrid.md');
        expect(results[1]!.path).toBe('pure-vector.md');
    });
});
