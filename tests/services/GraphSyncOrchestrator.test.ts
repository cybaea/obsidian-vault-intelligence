/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { Events, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphSyncOrchestrator } from '../../src/services/GraphSyncOrchestrator';

// Mock requestIdleCallback for test environment
if (typeof globalThis.requestIdleCallback === 'undefined') {
    (globalThis as any).requestIdleCallback = (cb: () => void) => setTimeout(() => cb(), 1);
    (globalThis as any).cancelIdleCallback = (id: number) => clearTimeout(id);
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

const mockWorkerManager = {
    activeModel: { dimension: 768, id: 'test-model' },
    executeMutation: vi.fn().mockImplementation((fn): any => fn(mockWorkerApi)),
    executeQuery: vi.fn().mockImplementation((fn): any => fn(mockWorkerApi)),
    getApi: vi.fn().mockReturnValue({}),
    initializeWorker: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn(),
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

const mockWorkerApi = {
    deleteFile: vi.fn(),
    fullReset: vi.fn(),
    getFileStates: vi.fn().mockResolvedValue({}),
    loadIndex: vi.fn().mockResolvedValue(true),
    saveIndex: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    updateAliasMap: vi.fn(),
    updateConfig: vi.fn(),
    updateFiles: vi.fn(),
};

describe('GraphSyncOrchestrator', () => {
    let orchestrator: GraphSyncOrchestrator;
    let settings: any;

    beforeEach(() => {
        settings = {
            embeddingDimension: 768,
            embeddingModel: 'test-model',
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

    it('should initialize and start scanning on startNode', async () => {
        await orchestrator.startNode();

        expect(orchestrator.isNodeRunning).toBe(true);
        expect(mockWorkerManager.initializeWorker).toHaveBeenCalled();
        expect(mockPersistenceManager.ensureGitignore).toHaveBeenCalled();
        expect(mockPersistenceManager.loadState).toHaveBeenCalledWith('test-model', 768);
    });

    it('should debounce file updates', async () => {
        await orchestrator.startNode();
        expect(orchestrator.isNodeRunning).toBe(true);

        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mock file creation needs custom casting
        const mockFile = { path: 'test.md', stat: { size: 100 } } as unknown as TFile;
        mockVaultManager.getFileByPath.mockReturnValue(mockFile);
        const modifyCallback = mockVaultManager.onModify.mock.calls[0][0];

        modifyCallback(mockFile);

        // Should not have processed yet
        expect(mockWorkerApi.updateFiles).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();
        await vi.waitUntil(() => mockWorkerApi.updateFiles.mock.calls.length > 0);

        expect(mockWorkerApi.updateFiles).toHaveBeenCalled();
    });

    it('should handle file renames by deleting old and updating new', async () => {
        await orchestrator.startNode();
        expect(orchestrator.isNodeRunning).toBe(true);

        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mock file creation needs custom casting
        const mockNewFile = { path: 'new.md', stat: { size: 100 } } as unknown as TFile;
        mockVaultManager.getFileByPath.mockImplementation((path: string) => (path === 'new.md' ? mockNewFile : null));

        const renameCallback = mockVaultManager.onRename.mock.calls[0][0];

        renameCallback('old.md', 'new.md');

        expect(mockWorkerApi.deleteFile).toHaveBeenCalledWith('old.md');

        await vi.runAllTimersAsync();
        await vi.waitUntil(() => mockWorkerApi.updateFiles.mock.calls.length > 0);
        expect(mockWorkerApi.updateFiles).toHaveBeenCalled();
    });

    it('should perform a full reset on scanAll(true)', async () => {
        await orchestrator.scanAll(true);
        expect(mockWorkerApi.fullReset).toHaveBeenCalled();
    });

    it('should commit config changes by saving state and restarting', async () => {
        await orchestrator.startNode();
        await orchestrator.commitConfigChange();

        expect(mockPersistenceManager.saveState).toHaveBeenCalled();
        expect(mockWorkerManager.terminate).toHaveBeenCalled();
        expect(mockWorkerManager.initializeWorker).toHaveBeenCalledTimes(2);
    });
});
