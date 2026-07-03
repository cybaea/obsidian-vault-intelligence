import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GraphService } from '../../src/services/GraphService';

describe('GraphService Facade', () => {
    let graphService: GraphService;
    const mockApp = {} as any;
    const mockVaultManager = {} as any;
    const mockSettings = {} as any;
    const mockWorkerManager = {
        executeQuery: vi.fn(),
    } as any;

    beforeEach(() => {
        graphService = new GraphService(mockApp, mockVaultManager, mockWorkerManager, mockSettings);
    });

    it('should proxy keywordSearch to WorkerManager', async () => {
        mockWorkerManager.executeQuery.mockResolvedValue([]);
        await graphService.keywordSearch('query');
        expect(mockWorkerManager.executeQuery).toHaveBeenCalled();
    });

    it('should proxy getNeighbors to WorkerManager', async () => {
        mockWorkerManager.executeQuery.mockResolvedValue([]);
        await graphService.getNeighbors('path');
        expect(mockWorkerManager.executeQuery).toHaveBeenCalled();
    });

    it('should proxy getSimilar to WorkerManager', async () => {
        mockWorkerManager.executeQuery.mockResolvedValue([]);
        await graphService.getSimilar('path');
        expect(mockWorkerManager.executeQuery).toHaveBeenCalled();
    });
});