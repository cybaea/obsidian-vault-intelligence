/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/unbound-method -- Mocks in tests are fine */
import { Plugin } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceManager } from '../../src/services/PersistenceManager';
import { StorageProvider } from '../../src/services/StorageProvider';

// Mock dependencies
const mockPlugin = {
    app: {
        vault: {
            adapter: {
                exists: vi.fn(),
                mkdir: vi.fn(),
                readBinary: vi.fn(),
                remove: vi.fn(),
                rmdir: vi.fn(),
                write: vi.fn(),
                writeBinary: vi.fn(),
            }
        }
    },
    manifest: {
        dir: 'test-dir'
    }
} as unknown as Plugin;

// Mock StorageProvider
vi.mock('../../src/services/StorageProvider', () => {
    const MockStorageProvider = vi.fn();
    MockStorageProvider.prototype.put = vi.fn();
    MockStorageProvider.prototype.get = vi.fn();
    MockStorageProvider.prototype.clear = vi.fn();
    MockStorageProvider.prototype.delete = vi.fn();
    return {
        StorageProvider: MockStorageProvider,
        STORES: { VECTORS: 'vectors' }
    };
});

describe('PersistenceManager Resilience', () => {
    let persistenceManager: PersistenceManager;
    let mockStorage: any;

    beforeEach(() => {
        vi.clearAllMocks();
        persistenceManager = new PersistenceManager(mockPlugin);
        // Get the instance of the mocked StorageProvider
        mockStorage = (persistenceManager as any).storage;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('saveState()', () => {
        it('should proceed to write availability to Cold Store even if Hot Store (IDB) fails', async () => {
            const stateBuffer = new Uint8Array([1, 2, 3]);
            const modelId = 'test-model';
            const dimension = 128;

            // Mock IDB failure
            mockStorage.put.mockRejectedValue(new Error('QuotaExceededError'));

            // Mock File System success
            (mockPlugin.app.vault.adapter.exists as any).mockResolvedValue(true); // data folder exists
            (mockPlugin.app.vault.adapter.writeBinary as any).mockResolvedValue(undefined);

            await persistenceManager.saveState(stateBuffer, modelId, dimension);

            // Verify IDB was attempted
            expect(mockStorage.put).toHaveBeenCalled();

            // Verify File System was STILL written to
            expect(mockPlugin.app.vault.adapter.writeBinary).toHaveBeenCalledWith(
                expect.stringContaining('graph-state-'),
                expect.anything()
            );
        });
    });

    describe('purgeAllData()', () => {
        it('should proceed to wipe Vault data even if Hot Store (IDB) clear fails', async () => {
            // Mock IDB failure
            mockStorage.clear.mockRejectedValue(new Error('DatabaseCorrupted'));

            // Mock Vault folder exists
            (mockPlugin.app.vault.adapter.exists as any).mockResolvedValue(true);
            (mockPlugin.app.vault.adapter.rmdir as any).mockResolvedValue(undefined);

            await persistenceManager.purgeAllData();

            // Verify IDB clear was attempted
            expect(mockStorage.clear).toHaveBeenCalled();

            // Verify Vault wipe was STILL attempted
            expect(mockPlugin.app.vault.adapter.rmdir).toHaveBeenCalled();
        });
    });

    describe('deleteState()', () => {
        it('should not throw if Hot Store (IDB) delete fails', async () => {
            const fileName = 'graph-state-test-128-hash.msgpack';

            // Mock File exists and remove succeeds
            (mockPlugin.app.vault.adapter.exists as any).mockResolvedValue(true);
            (mockPlugin.app.vault.adapter.remove as any).mockResolvedValue(undefined);

            // Mock IDB delete failure
            mockStorage.delete.mockRejectedValue(new Error('KeyNotFound'));

            // Should not throw
            await expect(persistenceManager.deleteState(fileName)).resolves.not.toThrow();

            // Verify both were called
            expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalled();
            expect(mockStorage.delete).toHaveBeenCalled();
        });
    });

    describe('loadState()', () => {
        it('should return Cold Store data even if Hot Store (IDB) hydration fails', async () => {
            const modelId = 'test-model';
            const dimension = 128;
            const stateBuffer = new Uint8Array([1, 2, 3]);

            // Mock IDB miss (so it goes to Cold Store)
            mockStorage.get.mockRejectedValue(new Error('Miss'));

            // Mock File System success
            (mockPlugin.app.vault.adapter.exists as any).mockResolvedValue(true);
            (mockPlugin.app.vault.adapter.readBinary as any).mockResolvedValue(stateBuffer.buffer);

            // Mock IDB hydration failure
            mockStorage.put.mockRejectedValue(new Error('QuotaExceededError'));

            // Should return the buffer despite IDB failure
            const result = await persistenceManager.loadState(modelId, dimension);

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result).toEqual(stateBuffer);

            // Verify IDB hydration was attempted
            expect(mockStorage.put).toHaveBeenCalled();
        });
    });
});
