import { App } from 'obsidian';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

import { GeminiService } from '../../src/services/GeminiService';
import { VaultIntelligenceSettings } from '../../src/settings';

describe('GeminiService', () => {
    let service: GeminiService;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockGetSecret: Mock;

    beforeEach(() => {
        mockSettings = {
            googleApiKey: '',
            secretStorageFailure: false,
        } as VaultIntelligenceSettings;

        mockGetSecret = vi.fn();

        mockApp = {
            secretStorage: {
                deleteSecret: vi.fn(),
                getSecret: mockGetSecret,
                hasSecret: vi.fn(),
                setSecret: vi.fn(),
            },
        } as unknown as App;

        service = new GeminiService(mockSettings, mockApp);
    });

    describe('getApiKey', () => {
        it('should return null if no key is stored', async () => {
            mockSettings.googleApiKey = '';
            const key = await service.getApiKey();
            expect(key).toBeNull();
        });

        it('should return raw key if it starts with AIza', async () => {
            mockSettings.googleApiKey = 'AIzaSyD-TestKey123';
            const key = await service.getApiKey();
            expect(key).toBe('AIzaSyD-TestKey123');
            expect(mockGetSecret).not.toHaveBeenCalled();
        });

        it('should return raw key if secretStorageFailure is true', async () => {
            mockSettings.googleApiKey = 'some-key';
            mockSettings.secretStorageFailure = true;
            const key = await service.getApiKey();
            expect(key).toBe('some-key');
            expect(mockGetSecret).not.toHaveBeenCalled();
        });

        it('should call secretStorage.getSecret for the default secret ID', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockReturnValue('secret-from-storage');

            const key = await service.getApiKey();

            expect(mockGetSecret).toHaveBeenCalledWith('vault-intelligence-api-key');
            expect(key).toBe('secret-from-storage');
        });

        it('should call secretStorage.getSecret for custom secret IDs', async () => {
            mockSettings.googleApiKey = 'my-custom-secret-id';
            mockGetSecret.mockReturnValue('custom-secret-value');

            const key = await service.getApiKey();

            expect(mockGetSecret).toHaveBeenCalledWith('my-custom-secret-id');
            expect(key).toBe('custom-secret-value');
        });

        it('should return null if secretStorage throws an error', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockImplementation(() => {
                throw new Error('Access denied');
            });

            const key = await service.getApiKey();

            expect(key).toBeNull();
        });
    });
});
