/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
import { Plugin } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphService } from '../../src/services/GraphService';
import { PersistenceManager } from '../../src/services/PersistenceManager';

// Interface to access private members for testing
interface TestableGraphService {
    activeDimension: number | null;
    activeModelId: string | null;
    enqueueIndexingTask: <T>(task: () => Promise<T>) => Promise<T>;
    processingQueue: Promise<unknown>;
    reindexQueued: boolean;
    saveState: () => Promise<void>;
    settings: any;
    workerManager: any;
    workerSessionId: number;
}

// Mock dependencies
const mockPlugin = {
    app: {
        metadataCache: {
            getFileCache: vi.fn().mockReturnValue({ links: [] }),
            getFirstLinkpathDest: vi.fn(),
            on: vi.fn()
        },
        vault: {
            on: vi.fn()
        },
        workspace: {
            getActiveFile: vi.fn()
        }
    }
} as unknown as Plugin;

const mockVaultManager = {
    getFileByPath: vi.fn(),
    getFileStat: vi.fn().mockReturnValue({ basename: 'test', mtime: 1000, size: 100 }),
    getMarkdownFiles: vi.fn().mockReturnValue([]),
    onDelete: vi.fn(),
    onModify: vi.fn(),
    onRename: vi.fn(),
    readFile: vi.fn().mockResolvedValue('test content'),
} as any;

const mockGeminiService = {} as any;
const mockEmbeddingService = {} as any;

const mockPersistenceManager = {
    ensureGitignore: vi.fn(),
    getSanitizedModelId: vi.fn((model, dim) => `sanitized-${model}-${dim}`),
    loadState: vi.fn().mockResolvedValue(null), // Default to fresh start
    saveState: vi.fn(),
};

const mockWorkerApi = {
    deleteFile: vi.fn(),
    fullReset: vi.fn(),
    getFileStates: vi.fn().mockResolvedValue({}),
    initialize: vi.fn().mockResolvedValue(true),
    loadIndex: vi.fn().mockResolvedValue(true),
    pruneOrphans: vi.fn(),
    saveIndex: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    updateAliasMap: vi.fn(),
    updateConfig: vi.fn(),
    updateFile: vi.fn(),
    updateFiles: vi.fn(),
};

// Mock WorkerManager (we need to intercept its creation)
const mockWorkerManager = {
    getApi: vi.fn().mockReturnValue(mockWorkerApi),
    initializeWorker: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn(),
};

// Mock Notice
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as object),
        Notice: vi.fn(),
        Plugin: class { }
    };
});

describe('GraphService Lifecycle & Sharding', () => {
    let graphService: GraphService;
    let settings: any;

    beforeEach(() => {
        settings = {
            embeddingChunkSize: 1000,
            embeddingDimension: 768,
            embeddingModel: 'old-model',
            embeddingProvider: 'google',
            indexingDelayMs: 100,
            indexingExclusionPaths: []
        };

        graphService = new GraphService(
            mockPlugin,
            mockVaultManager,
            mockGeminiService,
            mockEmbeddingService,
            mockPersistenceManager as unknown as PersistenceManager,
            settings
        );

        // Inject mock worker manager
        (graphService as unknown as TestableGraphService).workerManager = mockWorkerManager;

        vi.useFakeTimers();
    });

    afterEach(() => {
        graphService.shutdown();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('should freeze active model state upon initialization', async () => {
        await graphService.initialize();

        const testable = graphService as unknown as TestableGraphService;

        // Access private properties to verify
        expect(testable.activeModelId).toBe('old-model');
        expect(testable.activeDimension).toBe(768);

        // Verify PersistenceManager was called with these
        expect(mockPersistenceManager.getSanitizedModelId).toHaveBeenCalledWith('old-model', 768);
    });

    it('should save state using the FROZEN active model ID, even if settings change', async () => {
        await graphService.initialize();

        const testable = graphService as unknown as TestableGraphService;

        // Simulate user changing settings through UI (but not committed yet)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Settings object is untyped
        testable.settings.embeddingModel = 'new-model';

        // Trigger a save
        await testable.saveState();

        // Should save to 'old-model' because that is the active worker's state
        expect(mockPersistenceManager.saveState).toHaveBeenCalledWith(
            expect.any(Uint8Array),
            'old-model',
            768
        );
        expect(mockPersistenceManager.saveState).not.toHaveBeenCalledWith(
            expect.any(Uint8Array),
            'new-model',
            expect.any(Number)
        );
    });

    it('should drop "zombie" tasks from previous worker sessions', async () => {
        await graphService.initialize();
        const testable = graphService as unknown as TestableGraphService;
        const initialSessionId = testable.workerSessionId;

        // Spy on the processing queue execution
        let taskExecuted = false;

        // Mock processingQueue to be able to inject a microtask delay or inspect it
        // Rather than artificially blocking, we can rely on the async nature

        // Let's create a promise that we can control
        let resolveQueue: (v?: unknown) => void;
        const blockingTask = new Promise((resolve) => { resolveQueue = resolve; });

        // artificially block the queue
        testable.processingQueue = blockingTask;

        // Enqueue the test task
        const zombieTask = testable.enqueueIndexingTask(async () => {
            taskExecuted = true;
            await Promise.resolve(); // satisfying require-await
            return 'success';
        });

        // Simulate a restart (increment session ID)
        testable.workerSessionId = initialSessionId + 1;

        // Release queue
        resolveQueue!();

        // Wait for the zombie task to "finish"
        try {
            await zombieTask;
        } catch (e: any) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Error object is untyped
            expect(e.message).toContain("TaskDropped");
        }

        expect(taskExecuted).toBe(false);
    });

    it('should perform a graceful worker swap on commitConfigChange', async () => {
        await graphService.initialize();
        const testable = graphService as unknown as TestableGraphService;

        // 1. Queue a reindex
        const newSettings = {
            ...settings,
            embeddingDimension: 512,
            embeddingModel: 'new-model'
        };
        await graphService.updateConfig(newSettings);

        expect(testable.reindexQueued).toBe(true);
        expect(mockWorkerApi.updateConfig).toHaveBeenCalled();

        // Ensure UNSAFE config was NOT pushed to worker
        const calls = mockWorkerApi.updateConfig.mock.calls;
        const configCall = calls[0]?.[0];

        expect(configCall).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Mock calls array is untyped
        expect(configCall.embeddingModel).toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Mock calls array is untyped
        expect(configCall.sanitizedModelId).toBeUndefined();

        // 2. Commit change
        await graphService.commitConfigChange();

        // Expect Sequence:
        // 1. Save Old State
        expect(mockPersistenceManager.saveState).toHaveBeenCalledWith(expect.any(Uint8Array), 'old-model', 768);

        // 2. Terminate Old Worker
        expect(mockWorkerManager.terminate).toHaveBeenCalled();

        // 3. Initialize New Worker (Implicitly verified by checking activeModelId update)
        expect(testable.activeModelId).toBe('new-model');
        expect(testable.activeDimension).toBe(512);

        // 4. Load New State
        expect(mockPersistenceManager.loadState).toHaveBeenCalledWith('new-model', 512);

        // 5. Scan (Delta)
        expect(mockWorkerApi.getFileStates).toHaveBeenCalled();
    });

    it('should trigger delete and re-index on file rename', async () => {
        await graphService.initialize();
        const testable = graphService as unknown as TestableGraphService;

        // Mock getFileByPath to return a dummy file for the new path
        const mockNewFile = { path: 'new-path.md', stat: { size: 100 } } as any;
        mockVaultManager.getFileByPath.mockReturnValue(mockNewFile);

        // Simulation of rename event
        const onRenameCallback = mockVaultManager.onRename.mock.calls[0][0];
        onRenameCallback('old-path.md', 'new-path.md');

        // wait for deleteFile
        await vi.waitFor(() => {
            expect(mockWorkerApi.deleteFile).toHaveBeenCalledWith('old-path.md');
        });

        // 2. Advance timers to trigger the debouncer
        vi.advanceTimersByTime(200);

        // wait for updateFiles
        await vi.waitFor(() => {
            expect(mockWorkerApi.updateFiles).toHaveBeenCalled();
        });

        expect(testable.workerSessionId).toBeGreaterThan(0);
    });
});
