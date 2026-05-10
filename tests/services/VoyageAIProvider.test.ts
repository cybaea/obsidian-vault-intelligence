import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoyageAIProvider } from '../../src/services/VoyageAIProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        Notice: vi.fn(),
        requestUrl: vi.fn(),
    };
});

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

    describe('createBatches', () => {
        it('should split texts into batches based on token limits', () => {
            const texts = new Array(20).fill('a'.repeat(100000));
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- testing private method
            const batches = (provider as any).createBatches(texts) as string[][];
            
            expect(batches.length).toBeGreaterThan(1);
            const firstBatch = batches[0];
            if (firstBatch) {
                expect(firstBatch.length).toBeLessThan(texts.length);
            }
        });

        it('should respect the 1000 chunk limit', () => {
            const texts = new Array(1500).fill('short');
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- testing private method
            const batches = (provider as any).createBatches(texts) as string[][];
            
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
