/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */

import { TFile } from 'obsidian';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ContextAssembler } from '../../src/services/ContextAssembler';
import { PersistenceManager } from '../../src/services/PersistenceManager';

// Mock StorageProvider properly as a class
const mockStorageInstance = {
    clear: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
};

vi.mock('../../src/services/StorageProvider', () => {
    return {
        StorageProvider: class {
            clear = mockStorageInstance.clear.mockResolvedValue(undefined);
            delete = mockStorageInstance.delete.mockResolvedValue(undefined);
            get = mockStorageInstance.get.mockResolvedValue(null);
            put = mockStorageInstance.put.mockResolvedValue(undefined);
        },
        STORES: { VECTORS: 'vectors' },
    };
});

// Mock Obsidian
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as object),
        normalizePath: (p: string) => p,
        TFile: class {
            path: string;
            constructor(path: string) { this.path = path; }
        },
    };
});

describe('Storage & Migration Integration', () => {
    let persistenceManager: PersistenceManager;
    let mockPlugin: any;

    beforeEach(() => {
        mockPlugin = {
            app: {
                vault: {
                    adapter: {
                        exists: vi.fn().mockResolvedValue(false),
                        mkdir: vi.fn().mockResolvedValue(undefined),
                        readBinary: vi.fn(),
                        remove: vi.fn().mockResolvedValue(undefined),
                        writeBinary: vi.fn().mockResolvedValue(undefined),
                    }
                }
            },
            manifest: { dir: 'plugins/vault-intelligence' }
        };

        persistenceManager = new PersistenceManager(mockPlugin);
        vi.clearAllMocks();
    });



    describe('IDB Isolation (Split-Brain Prevention)', () => {
        it('should use "orama_index_buffer_" prefix for Main-Thread UI persistence', async () => {
            const buffer = new Uint8Array([1, 2, 3]);

            mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);
            await persistenceManager.saveState(buffer, 'test-model', 768);

            const sanitizedId = persistenceManager.getSanitizedModelId('test-model', 768);
            expect(mockStorageInstance.put).toHaveBeenCalledWith(
                'vectors',
                `orama_index_buffer_${sanitizedId}`,
                expect.any(Uint8Array)
            );
        });
    });

    describe('IDB Cleanup', () => {
        it('should remove IDB keys when a state file is deleted', async () => {
            const fileName = 'graph-state-test-model-768-abc.msgpack';

            mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);

            await persistenceManager.deleteState(fileName);

            expect(mockStorageInstance.delete).toHaveBeenCalledWith('vectors', 'orama_index_buffer_test-model-768-abc');
            expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalled();
        });

        it('should perform a full IDB clear on purgeAllData', async () => {
            mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);
            await persistenceManager.purgeAllData();
            expect(mockStorageInstance.clear).toHaveBeenCalled();
        });
    });
});

describe('Token Fallback Integration', () => {
    let contextAssembler: ContextAssembler;
    let mockApp: any;

    beforeEach(() => {
        mockApp = {
            metadataCache: {
                getFileCache: vi.fn().mockReturnValue({})
            },
            vault: {
                cachedRead: vi.fn(),
                getAbstractFileByPath: vi.fn(),
            },
        };
        contextAssembler = new ContextAssembler(mockApp);
    });

    it('should use fallback estimate when tokenCount is missing', async () => {
        const results: any[] = [{
            path: 'test.md',
            score: 1.0,
            tokenCount: undefined
        }];

        const mockFile = new (TFile as any)('test.md');
        mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
        mockApp.vault.cachedRead.mockResolvedValue('Hello World');

        const assembled = await contextAssembler.assemble(results, 'query', 1000);
        expect(assembled.context).toContain('Hello World');
    });
});
