
import { App, requestUrl } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

import { VoyageAIProvider } from '../../src/services/VoyageAIProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        Notice: vi.fn(),
        requestUrl: vi.fn(),
    };
});

/**
 * Interface to expose private methods for testing.
 */
interface VoyageAIProviderTestInstance {
    createBatches(texts: string[]): string[][];
}

interface RequestUrlMockParams {
    body: string;
    headers: Record<string, string>;
    method: string;
    url: string;
}

describe('VoyageAIProvider', () => {
    let provider: VoyageAIProvider;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            embeddingDimension: 1024,
            embeddingModel: 'voyage/voyage-4',
            secretStorageFailure: false,
            voyageApiKey: 'pa-test-key',
            voyageRetries: 1,
        } as unknown as VaultIntelligenceSettings;

        mockApp = {
            secretStorage: {
                getSecret: vi.fn().mockReturnValue(null),
            },
        } as unknown as App;

        provider = new VoyageAIProvider(mockSettings, mockApp);
    });

    describe('API Payload Verification', () => {
        it('should send correct input_type and output_dimension for embedQuery', async () => {
            const mockResponse = {
                json: {
                    data: [{ embedding: [0.1, 0.2], index: 0 }],
                    usage: { total_tokens: 10 }
                },
                status: 200
            };
            (requestUrl as Mock).mockResolvedValue(mockResponse);

            await provider.embedQuery('test query');

            const firstCall = (requestUrl as Mock).mock.calls[0];
            if (!firstCall) throw new Error('Request not called');
            const callArgs = firstCall[0] as RequestUrlMockParams;
            expect(callArgs.body).toContain('"input_type":"query"');
            // output_dimension should NOT be present if it's 1024 (default)
            expect(callArgs.body).not.toContain('"output_dimension":1024');
        });

        it('should send output_dimension when it differs from default', async () => {
            const mockResponse = {
                json: {
                    data: [{ embedding: [0.1, 0.2], index: 0 }],
                    usage: { total_tokens: 10 }
                },
                status: 200
            };
            (requestUrl as Mock).mockResolvedValue(mockResponse);

            mockSettings.embeddingDimension = 512;
            await provider.embedQuery('test query');

            const firstCall = (requestUrl as Mock).mock.calls[0];
            if (!firstCall) throw new Error('Request not called');
            const callArgs = firstCall[0] as RequestUrlMockParams;
            expect(callArgs.body).toContain('"output_dimension":512');
        });

        it('should send correct input_type for embedDocument', async () => {
            const mockResponse = {
                json: {
                    data: [{ embedding: [0.1, 0.2], index: 0 }],
                    usage: { total_tokens: 10 }
                },
                status: 200
            };
            (requestUrl as Mock).mockResolvedValue(mockResponse);

            await provider.embedDocument('test document');

            const firstCall = (requestUrl as Mock).mock.calls[0];
            if (!firstCall) throw new Error('Request not called');
            const callArgs = firstCall[0] as RequestUrlMockParams;
            expect(callArgs.body).toContain('"input_type":"document"');
        });

        it('should send correct input_type for embedChunks', async () => {
            const mockResponse = {
                json: {
                    data: [{ embedding: [0.1, 0.2], index: 0 }],
                    usage: { total_tokens: 10 }
                },
                status: 200
            };
            (requestUrl as Mock).mockResolvedValue(mockResponse);

            await provider.embedChunks(['chunk1']);

            const firstCall = (requestUrl as Mock).mock.calls[0];
            if (!firstCall) throw new Error('Request not called');
            const callArgs = firstCall[0] as RequestUrlMockParams;
            expect(callArgs.body).toContain('"input_type":"document"');
        });
    });

    describe('createBatches', () => {
        it('should split texts into batches based on token limits', () => {
            const texts: string[] = Array.from({ length: 20 }, () => 'a'.repeat(100000));
            
            const providerTest = provider as unknown as VoyageAIProviderTestInstance;
            const batches = providerTest.createBatches(texts);
            
            expect(batches.length).toBeGreaterThan(1);
            const firstBatch = batches[0];
            if (firstBatch) {
                expect(firstBatch.length).toBeLessThan(texts.length);
            }
        });

        it('should respect the 1000 chunk limit', () => {
            const texts: string[] = Array.from({ length: 1500 }, () => 'short');
            
            const providerTest = provider as unknown as VoyageAIProviderTestInstance;
            const batches = providerTest.createBatches(texts);
            
            expect(batches).toHaveLength(2);
            const b0 = batches[0];
            const b1 = batches[1];
            if (b0 && b1) {
                expect(b0).toHaveLength(1000);
                expect(b1).toHaveLength(500);
            }
        });
    });
});