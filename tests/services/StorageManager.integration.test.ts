/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */

import { encode } from "@msgpack/msgpack";
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

    describe('Migration Data-Loss Bug Fix', () => {
        it('should correctly migrate states with top-level model ID metadata', async () => {
            const legacyPath = '.vault-intelligence/graph-state.msgpack';
            const stateData = {
                embeddingDimension: 768,
                embeddingModel: 'test-model',
                nodes: []
            };
            const buffer = encode(stateData);

            mockPlugin.app.vault.adapter.readBinary.mockResolvedValue(buffer.buffer);

            // Mock ONLY the legacy state file as existing, ANY sharded file as NOT existing
            mockPlugin.app.vault.adapter.exists.mockImplementation((path: string) => {
                if (path.includes('graph-state-')) return Promise.resolve(false); // Shards don't exist
                if (path.includes('graph-state.msgpack')) return Promise.resolve(true); // Legacy exists
                return Promise.resolve(false);
            });

            // Call loadState which triggers handleMigrations
            await persistenceManager.loadState('test-model', 768);

            // Assertions
            expect(mockPlugin.app.vault.adapter.writeBinary).toHaveBeenCalled();
            expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalledWith(legacyPath);
        });

        it('should NOT migrate if actualModelId is missing (Top-level check)', async () => {
            const legacyPath = '.vault-intelligence/graph-state.msgpack';
            const malformedData = { someOtherField: 'junk' };
            const buffer = encode(malformedData);

            mockPlugin.app.vault.adapter.readBinary.mockResolvedValue(buffer.buffer);
            mockPlugin.app.vault.adapter.exists.mockImplementation((path: string) => {
                if (path.includes('graph-state-')) return Promise.resolve(false);
                if (path.includes('graph-state.msgpack') && !path.includes('plugins')) return Promise.resolve(true);
                return Promise.resolve(false);
            });

            await persistenceManager.loadState('test-model', 768);

            // Assertions
            // It should NOT write to ANY sharded path
            expect(mockPlugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();
            // It SHOULD remove the malformed legacy file
            expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalledWith(legacyPath);
        });
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
