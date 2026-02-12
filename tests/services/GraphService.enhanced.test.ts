/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { Plugin } from 'obsidian';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should boost score when a file is both a vector match and a neighbor', async () => {
        const filePath = 'folder/note.md';

        // Mock Vector Results (Content match)
        const vectorResults: GraphSearchResult[] = [
            { path: 'folder/other.md', score: 0.8 } as GraphSearchResult
        ];

        // Mock Neighbor Results (Graph connection)
        const neighborResults: GraphSearchResult[] = [
            { path: 'folder/other.md', score: 0.1 } as GraphSearchResult // Low score to trigger floor
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('folder/other.md');

        // Expected: Max(NeighborFloor(0.1), VectorScore(0.8) + Boost(0.2)) = 1.0
        expect(results[0]!.score).toBeCloseTo(1.0);
    });

    it('should apply a floor score of 0.1 to pure neighbors and show them if they exceed it', async () => {
        // Use permissive settings to verify scoring math without filtering
        const permissiveSettings = { ...mockSettings, minSimilarityScore: 0.0 };
        const localGraphService = new GraphService(
            mockPlugin,
            mockVaultManager,
            mockGeminiService,
            mockEmbeddingService,
            mockPersistenceManager,
            permissiveSettings
        );
        localGraphService.getSimilar = vi.fn().mockResolvedValue([]);
        localGraphService.getNeighbors = vi.fn();
        // Mock hydrator for local service
        interface TestableGraphService {
            hydrator: any;
        }
        (localGraphService as unknown as TestableGraphService).hydrator =
            (graphService as unknown as TestableGraphService).hydrator;

        const filePath = 'folder/note.md';

        // Neighbor match with score > 0.1
        const neighborResults: GraphSearchResult[] = [
            { path: 'folder/linked.md', score: 0.15 } as GraphSearchResult
        ];
        vi.spyOn(localGraphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await localGraphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('folder/linked.md');
        expect(results[0]!.score).toBe(0.15);
    });

    it('should prioritise hybrid matches over pure vector matches if score is higher', async () => {
        const filePath = 'folder/source.md';

        const vectorResults: GraphSearchResult[] = [
            { path: 'folder/vector_only.md', score: 0.85 } as GraphSearchResult,
            { path: 'folder/hybrid.md', score: 0.8 } as GraphSearchResult
        ];

        const neighborResults: GraphSearchResult[] = [
            { path: 'folder/hybrid.md', score: 0.1 } as GraphSearchResult
        ];

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectorResults);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        // Hybrid: max(0.1, 0.8 + 0.2) = 1.0
        // Vector Only: 0.85
        // Order: Hybrid > Vector Only
        expect(results[0]!.path).toBe('folder/hybrid.md');
        expect(results[0]!.score).toBeCloseTo(1.0);

        expect(results[1]!.path).toBe('folder/vector_only.md');
        expect(results[1]!.score).toBe(0.85);
    });

    it('should exclude the source file itself', async () => {
        const filePath = 'folder/self.md';

        vi.spyOn(graphService, 'getSimilar').mockResolvedValue([{ path: filePath, score: 1.0 } as GraphSearchResult]);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue([{ path: filePath, score: 1.0 } as GraphSearchResult]);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);
        expect(results).toHaveLength(0);
    });
    it('should filter out noise but keep significant graph neighbors', async () => {
        const filePath = 'folder/source.md';

        // 1. Setup: minScore is 0.5 (from mockSettings)
        // 2. Setup Neighbors:
        //    - "Good" Sibling: Score 0.25 (below minScore, but > floor 0.1) -> SHOULD KEEP
        //    - "Bad" Sibling (Hub): Score 0.05 -> Bumped to Floor 0.1 -> Equal to floor -> SHOULD DROP
        const neighbors: GraphSearchResult[] = [
            { path: 'good.md', score: 0.25 } as GraphSearchResult,
            { path: 'bad.md', score: 0.05 } as GraphSearchResult
        ];
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighbors);
        vi.spyOn(graphService, 'getSimilar').mockResolvedValue([]); // No vectors

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        // Expectation:
        // 'good.md' kept because 0.25 > 0.1 (Floor)
        // 'bad.md' dropped because 0.1 !> 0.1 (Floor) AND < 0.5 (MinScore)

        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('good.md');
    });
    it('should allow strong vector matches to bypass strict minSimilarityScore via the symmetric noise floor', async () => {
        const filePath = 'folder/source.md';

        // 1. Setup: minScore is 0.5 (from mockSettings)
        // 2. Setup Vector:
        //    - "Strong Vector": Score 0.45 (below minScore 0.5, but > floor 0.1) -> SHOULD KEEP
        const vectors: GraphSearchResult[] = [
            { path: 'vector_match.md', score: 0.45 } as GraphSearchResult
        ];
        vi.spyOn(graphService, 'getSimilar').mockResolvedValue(vectors);
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue([]);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        // Expectation:
        // 'vector_match.md' kept because 0.45 > 0.1 (Floor) even though it is < 0.5 (MinScore)
        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('vector_match.md');
        expect(results[0]!.score).toBe(0.45);
    });
});
