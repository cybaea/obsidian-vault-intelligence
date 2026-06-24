import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalEmbeddingService } from "../../src/services/LocalEmbeddingService";
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from "../../src/settings/types";

vi.mock("obsidian", () => ({
    Notice: vi.fn().mockImplementation(function() {
        return { hide: vi.fn() };
    }),
    requestUrl: vi.fn(),
}));

vi.mock("../../src/workers/embedding.worker", () => ({
    default: vi.fn().mockImplementation(() => ({
        postMessage: vi.fn(),
        terminate: vi.fn(),
    })),
}));

interface LocalEmbeddingServicePrivates {
    _onMessage: (e: unknown) => void;
    lastNotice: unknown;
    pendingRequests: Map<number, unknown>;
}

describe('LocalEmbeddingService', () => {
    let service: LocalEmbeddingService;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            embeddingModel: 'local/MinishLab/potion-base-8M',
            embeddingSimd: true,
            embeddingThreads: 1
        } as unknown as VaultIntelligenceSettings;
        mockPlugin = {
            saveSettings: vi.fn().mockResolvedValue(undefined),
        } as unknown as IVaultIntelligencePlugin;
        service = new LocalEmbeddingService(mockPlugin, mockSettings);
    });

    it('should hide notice on terminate', async () => {
        const mockNotice = { hide: vi.fn() };
        (service as unknown as LocalEmbeddingServicePrivates).lastNotice = mockNotice;
        
        await service.terminate();
        
        expect(mockNotice.hide).toHaveBeenCalled();
        expect((service as unknown as LocalEmbeddingServicePrivates).lastNotice).toBeNull();
    });

    it('should hide notice on task failure', () => {
        const mockNotice = { hide: vi.fn() };
        (service as unknown as LocalEmbeddingServicePrivates).lastNotice = mockNotice;
        
        // Simulate task error from worker
        (service as unknown as LocalEmbeddingServicePrivates).pendingRequests.set(1, { 
            reject: vi.fn(),
            resolve: vi.fn()
        });
        
        (service as unknown as LocalEmbeddingServicePrivates)._onMessage({ 
            data: { error: 'failed', id: 1, status: 'error' }
        });
        
        expect(mockNotice.hide).toHaveBeenCalled();
    });

    it('should respect embeddingLocalQuantized setting when generating embeddings', () => {
        const mockWorker = {
            postMessage: vi.fn(),
            terminate: vi.fn(),
        };
        (service as unknown as { worker: unknown }).worker = mockWorker;

        // Set model that defaults to quantized: local/Xenova/bge-m3
        mockSettings.embeddingModel = 'local/Xenova/bge-m3';
        
        // 1. With embeddingLocalQuantized = true
        mockSettings.embeddingLocalQuantized = true;
        (service as unknown as { requestQueue: unknown[] }).requestQueue = [{
            id: 1,
            priority: 'high',
            reject: vi.fn(),
            resolve: vi.fn(),
            text: 'test content'
        }];
        (service as unknown as { processQueue: () => void }).processQueue();
        expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            quantized: true
        }));

        // 2. With embeddingLocalQuantized = false
        mockWorker.postMessage.mockClear();
        mockSettings.embeddingLocalQuantized = false;
        (service as unknown as { isWorkerBusy: boolean }).isWorkerBusy = false;
        (service as unknown as { requestQueue: unknown[] }).requestQueue = [{
            id: 2,
            priority: 'high',
            reject: vi.fn(),
            resolve: vi.fn(),
            text: 'test content'
        }];
        (service as unknown as { processQueue: () => void }).processQueue();
        expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            quantized: false
        }));
    });
});
