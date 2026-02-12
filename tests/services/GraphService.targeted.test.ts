/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services requires dynamic access */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services requires dynamic calls */
/* eslint-disable @typescript-eslint/no-unsafe-return -- Mocking internal services */

import { Plugin } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphService } from '../../src/services/GraphService';
import { PersistenceManager } from '../../src/services/PersistenceManager';
import { WorkerAPI } from '../../src/types/graph';

// Mock dependencies
const mockPlugin = {
    app: {
        metadataCache: { on: vi.fn() },
        vault: {
            getAbstractFileByPath: vi.fn(),
            on: vi.fn()
        },
        workspace: { getActiveFile: vi.fn() }
    }
} as unknown as Plugin;

const mockVaultManager = {
    // Expected "getFileState" to come before "initialize" is irrelevant here as this is a mock object, 
    // but the linter complained about object keys elsewhere. 
    // The previous error was mainly about `getFileState` vs `initialize` in `mockWorkerApi`.
    getFileStat: vi.fn().mockReturnValue({ mtime: 1000, size: 500 }),
    getMarkdownFiles: vi.fn().mockReturnValue([]),
    getResolvedLinks: vi.fn().mockReturnValue([]),
    onDelete: vi.fn(),
    onModify: vi.fn(),
    onRename: vi.fn(),
    readFile: vi.fn().mockResolvedValue("File content")
} as any;

const mockGeminiService = {} as any;
const mockEmbeddingService = {} as any;
const mockPersistenceManager = {
    ensureGitignore: vi.fn(),
    getSanitizedModelId: vi.fn(),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn(),
} as unknown as PersistenceManager;

const mockWorkerApi = {
    getFileState: vi.fn().mockResolvedValue({ mtime: 1000, size: 500 }),
    getNeighbors: vi.fn(),
    getSimilar: vi.fn(),
    initialize: vi.fn()
} as unknown as WorkerAPI;

const mockWorkerManager = {
    getApi: vi.fn().mockReturnValue(mockWorkerApi),
    initializeWorker: vi.fn(),
    terminate: vi.fn(),
};

// Types needed for avoiding type errors when accessing private properties
interface TestableGraphService {
    activeDimension: number | null;
    activeModelId: string | null;
    api: any;
    hydrator: any;
    workerManager: any;
}

describe('GraphService - Targeted Hydration', () => {
    let graphService: GraphService;
    let settings: any;

    beforeEach(async () => {
        settings = {
            embeddingDimension: 768,
            embeddingModel: 'test-model',
            minSimilarityScore: 0.0 // Allow everything for testing
        };

        graphService = new GraphService(
            mockPlugin,
            mockVaultManager,
            mockGeminiService,
            mockEmbeddingService,
            mockPersistenceManager,
            settings
        );

        // Inject mocks
        (graphService as unknown as TestableGraphService).workerManager = mockWorkerManager;

        // Mock hydration to just return what it's given (pass-through)
        // We simulate hydration adding excerpts if they exist in vector results
        (graphService as unknown as TestableGraphService).hydrator = {
            hydrate: vi.fn().mockImplementation((results) => Promise.resolve({
                driftDetected: [],
                hydrated: results.map((r: any) => ({
                    ...r,
                    // Simulate hydration adding valid excerpt if we have vector match
                    // For the test, we assume vector results come with excerpts from worker or are hydrated effectively
                    excerpt: r.excerpt || "Hydrated content"
                }))
            }))
        };

        await graphService.initialize();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should retrieve missing neighbors via targeted fetch and merge them', async () => {
        const neighborPath = 'neighbor.md';

        // 1. Setup Neighbors: Note A is a neighbor
        (mockWorkerApi.getNeighbors as any).mockResolvedValue([
            { path: neighborPath, score: 1.0 }
        ]);

        // 2. Setup Global Vector Search: Note A is NOT present
        (mockWorkerApi.getSimilar as any).mockImplementation((path: string, limit: number, minScore: number, onlyPaths?: string[]) => {
            if (!onlyPaths) {
                // Global search - return some other file
                return Promise.resolve([
                    { excerpt: 'Other content', path: 'other.md', score: 0.8 }
                ]);
            } else if (onlyPaths.includes(neighborPath)) {
                // Targeted search - return Note A with weak score but valid excerpt
                return Promise.resolve([
                    { excerpt: 'Targeted content excerpt', path: neighborPath, score: 0.45 }
                ]);
            }
            return Promise.resolve([]);
        });

        // 3. Execute
        const results = await graphService.getGraphEnhancedSimilar('source.md', 10);

        // 4. Assert
        // Should find the neighbor
        const match = results.find(r => r.path === neighborPath);
        expect(match).toBeDefined();

        // Should have merged the targeted vector result properties
        expect(match?.excerpt).toBe('Targeted content excerpt');

        // Score should be boosted (0.45 + boost) OR floor, whichever is higher.
        expect(match?.score).toBeGreaterThanOrEqual(0.65);
    });
});
