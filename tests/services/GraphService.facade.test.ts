/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GraphService } from '../../src/services/GraphService';

describe('GraphService Facade', () => {
    let graphService: GraphService;
    const mockApp = {} as any;
    const mockVaultManager = {} as any;
    const mockWorkerManager = {
        executeQuery: vi.fn(),
    } as any;

    beforeEach(() => {
        graphService = new GraphService(mockApp, mockVaultManager, mockWorkerManager);
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
