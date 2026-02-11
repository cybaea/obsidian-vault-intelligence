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
    settings: {
        similarNotesLimit: 10
    }
} as unknown as Plugin;

const mockVaultManager = {} as any;
const mockGeminiService = {} as any;
const mockEmbeddingService = {} as any;
const mockPersistenceManager = {} as any;
const mockSettings = {
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

        // Expected: Max(NeighborFloor(0.65), VectorScore(0.8) + Boost(0.1)) = 0.9
        expect(results[0]!.score).toBeCloseTo(0.9);
    });

    it('should apply a floor score of 0.65 to pure neighbors', async () => {
        const filePath = 'folder/note.md';

        // No vector matches
        vi.spyOn(graphService, 'getSimilar').mockResolvedValue([]);

        // Only neighbor match (e.g. valid topic link)
        const neighborResults: GraphSearchResult[] = [
            { path: 'folder/linked.md', score: 0.1 } as GraphSearchResult // Very low score
        ];
        vi.spyOn(graphService, 'getNeighbors').mockResolvedValue(neighborResults);

        const results = await graphService.getGraphEnhancedSimilar(filePath, 10);

        expect(results).toHaveLength(1);
        expect(results[0]!.path).toBe('folder/linked.md');
        // Logic: Math.max(n.score, 0.65) -> Math.max(0.1, 0.65) = 0.65
        expect(results[0]!.score).toBe(0.65);
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

        // Hybrid: max(0.65, 0.8 + 0.1) = 0.9
        // Vector Only: 0.85
        // Order: Hybrid > Vector Only
        expect(results[0]!.path).toBe('folder/hybrid.md');
        expect(results[0]!.score).toBeCloseTo(0.9);

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
});
