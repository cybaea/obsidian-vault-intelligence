/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkerLifecycleManager } from '../../src/services/WorkerLifecycleManager';

if (typeof globalThis.requestIdleCallback === 'undefined') {
    (globalThis as any).requestIdleCallback = (cb: () => void) => setTimeout(() => cb(), 1);
    (globalThis as any).cancelIdleCallback = (id: number) => clearTimeout(id);
}

describe('WorkerLifecycleManager', () => {
    let lifecycle: WorkerLifecycleManager;
    let mockWorkerManager: any;
    let mockPersistenceManager: any;
    let mockOntologyService: any;
    let mockSettings: any;

    const mockWorkerApi = {
        loadIndex: vi.fn(),
        saveIndex: vi.fn(),
        updateConfig: vi.fn(),
    };

    beforeEach(() => {
        mockWorkerManager = {
            activeModel: { dimension: 768, id: 'test-model' },
            executeMutation: vi.fn().mockImplementation(async (fn): Promise<any> => await fn(mockWorkerApi)),
            executeQuery: vi.fn().mockImplementation(async (fn): Promise<any> => await fn(mockWorkerApi)),
            getApi: vi.fn().mockReturnValue(mockWorkerApi), // Fix: Return the mock API
            initializeWorker: vi.fn().mockResolvedValue(undefined),
            terminate: vi.fn(),
            waitForIdle: vi.fn().mockResolvedValue(undefined),
        };

        mockPersistenceManager = {
            DATA_DIR: '.vault-intelligence',
            ensureGitignore: vi.fn(),
            getSanitizedModelId: vi.fn((model, dim) => `sanitized-${model}-${dim}`),
            loadState: vi.fn().mockResolvedValue(null),
            saveState: vi.fn(),
        };

        mockOntologyService = {
            getValidTopics: vi.fn().mockResolvedValue([]),
        };

        mockSettings = {
            embeddingDimension: 768,
            embeddingModel: 'test-model',
        };

        mockWorkerApi.loadIndex.mockResolvedValue(true);
        mockWorkerApi.saveIndex.mockResolvedValue(new Uint8Array([1, 2, 3]));

        lifecycle = new WorkerLifecycleManager(
            mockWorkerManager,
            mockPersistenceManager,
            mockOntologyService,
            mockSettings
        );

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('should initialize worker', async () => {
        const needsScan = await lifecycle.initializeWorker();

        expect(needsScan).toBe(true); // Since loadState returned null
        expect(lifecycle.isNodeRunning).toBe(true);
        expect(mockWorkerManager.initializeWorker).toHaveBeenCalled();
        expect(mockPersistenceManager.ensureGitignore).toHaveBeenCalled();
    });

    it('should update configuration', async () => {
        const newSettings = { ...mockSettings, authorName: 'Allan' };
        await lifecycle.updateConfig(newSettings);

        expect(mockWorkerApi.updateConfig).toHaveBeenCalled();
    });

    it('should save state', async () => {
        await lifecycle.saveState();

        expect(mockWorkerApi.saveIndex).toHaveBeenCalled();
        expect(mockPersistenceManager.saveState).toHaveBeenCalledWith(expect.any(Uint8Array), 'test-model', 768);
    });

    it('should handle commitRestart', async () => {
        await lifecycle.commitRestart();

        expect(mockPersistenceManager.saveState).toHaveBeenCalled();
        expect(mockWorkerManager.terminate).toHaveBeenCalled();
        expect(mockWorkerManager.initializeWorker).toHaveBeenCalled();
    });

    it('should handle shutdownWorker', async () => {
        await lifecycle.shutdownWorker();

        expect(mockWorkerManager.waitForIdle).toHaveBeenCalled();
        expect(mockPersistenceManager.saveState).toHaveBeenCalled();
        expect(mockWorkerManager.terminate).toHaveBeenCalled();
        expect(lifecycle.isNodeRunning).toBe(false);
    });
});
