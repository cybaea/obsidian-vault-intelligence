/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- Mocking TFile requires casting */
import { Events, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphSyncOrchestrator } from '../../src/services/GraphSyncOrchestrator';

// Mock requestIdleCallback for test environment
if (typeof globalThis.requestIdleCallback === 'undefined') {
    (globalThis as any).requestIdleCallback = (cb: () => void) => activeWindow.setTimeout(() => cb(), 1);
    (globalThis as any).cancelIdleCallback = (id: number) => activeWindow.clearTimeout(id);
}

// Mock dependencies
const mockApp = {
    metadataCache: {
        getFileCache: vi.fn().mockReturnValue({ links: [] }),
        getFirstLinkpathDest: vi.fn(),
    },
    workspace: {
        getActiveFile: vi.fn(),
        onLayoutReady: vi.fn(async (cb) => { await cb(); }),
    },
} as any;

const mockVaultManager = {
    getFileByPath: vi.fn(),
    getFileStat: vi.fn().mockReturnValue({ basename: 'test', mtime: 1000, size: 100 }),
    getMarkdownFiles: vi.fn().mockReturnValue([]),
    onDelete: vi.fn(),
    onModify: vi.fn(),
    onRename: vi.fn(),
    readFile: vi.fn().mockResolvedValue('test content'),
} as any;

const mockWorkerApi = {
    deleteFile: vi.fn(),
    fullReset: vi.fn(),
    getFileStates: vi.fn().mockResolvedValue({}),
    loadIndex: vi.fn().mockResolvedValue(true),
    pruneOrphans: vi.fn(),
    saveIndex: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    updateAliasMap: vi.fn(),
    updateConfig: vi.fn(),
    updateFiles: vi.fn(),
};

const mockWorkerManager = {
    activeModel: { dimension: 768, id: 'test-model' },
    executeMutation: vi.fn().mockImplementation(async (fn): Promise<any> => await fn(mockWorkerApi)),
    executeQuery: vi.fn().mockImplementation(async (fn): Promise<any> => await fn(mockWorkerApi)),
    getApi: vi.fn().mockReturnValue(mockWorkerApi),
    initializeWorker: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn(),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
} as any;

const mockPersistenceManager = {
    DATA_DIR: '.vault-intelligence',
    ensureGitignore: vi.fn(),
    getSanitizedModelId: vi.fn((model, dim) => `sanitized-${model}-${dim}`),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn(),
};

const mockOntologyService = {
    getValidTopics: vi.fn().mockResolvedValue([]),
    initialize: vi.fn(),
} as any;

const mockEventBus = new Events();

describe('GraphSyncOrchestrator (Facade)', () => {
    let orchestrator: GraphSyncOrchestrator;
    let settings: any;

    beforeEach(() => {
        settings = {
            embeddingDimension: 768,
            embeddingModel: 'test-model',
            indexingDelayMs: 10,
        };

        orchestrator = new GraphSyncOrchestrator(
            mockApp,
            mockVaultManager,
            mockWorkerManager,
            mockPersistenceManager as any,
            settings,
            mockOntologyService,
            mockEventBus
        );

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('should delegate initialization to WorkerLifecycleManager', async () => {
        await orchestrator.startNode();

        expect(mockWorkerManager.initializeWorker).toHaveBeenCalled();
        expect(mockPersistenceManager.ensureGitignore).toHaveBeenCalled();
    });

    it('should coordinate scanAll by identifying changes and delegating to EventDebouncer', async () => {
        const mockFile = { basename: 'test', path: 'test.md', stat: { size: 100 } } as unknown as TFile;
        mockVaultManager.getMarkdownFiles.mockReturnValue([mockFile]);
        mockVaultManager.getFileByPath.mockReturnValue(mockFile);
        mockWorkerApi.getFileStates.mockResolvedValue({});

        await orchestrator.scanAll();

        expect(mockWorkerApi.updateFiles).toHaveBeenCalled();
    });

    it('should handle commitConfigChange by pausing, flushing, restarting, and resuming', async () => {
        const eventDebouncer = (orchestrator as any).eventDebouncer;
        const pauseSpy = vi.spyOn(eventDebouncer, 'pause');
        const flushSpy = vi.spyOn(eventDebouncer, 'flushPending');
        const resumeSpy = vi.spyOn(eventDebouncer, 'resume');

        await orchestrator.commitConfigChange();

        expect(pauseSpy).toHaveBeenCalled();
        expect(flushSpy).toHaveBeenCalled();
        expect(mockWorkerManager.terminate).toHaveBeenCalled();
        expect(mockWorkerManager.initializeWorker).toHaveBeenCalled();
        expect(resumeSpy).toHaveBeenCalled();
    });

    it('should handle flushAndShutdown by pausing, flushing and shutting down worker', async () => {
        const eventDebouncer = (orchestrator as any).eventDebouncer;
        const pauseSpy = vi.spyOn(eventDebouncer, 'pause');
        const flushSpy = vi.spyOn(eventDebouncer, 'flushPending');

        await orchestrator.flushAndShutdown();

        expect(pauseSpy).toHaveBeenCalled();
        expect(flushSpy).toHaveBeenCalled();
        expect(mockWorkerManager.terminate).toHaveBeenCalled();
    });
});
