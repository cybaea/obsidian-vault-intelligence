import { App, Notice } from 'obsidian';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { GeminiService } from '../../src/services/GeminiService';
import { VaultIntelligenceSettings } from '../../src/settings';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        Notice: vi.fn(),
    };
});

describe('GeminiService', () => {
    let service: GeminiService;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockGetSecret: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            geminiRetries: 1,
            googleApiKey: '',
            secretStorageFailure: false,
        } as unknown as VaultIntelligenceSettings;

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

    describe('getClient UX Polish', () => {
        it('should show a Notice if API key is missing from storage but secret ID exists', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockReturnValue(null);

            // Trigger getClient
            await service.generateContent('test').catch(() => { });

            expect(Notice).toHaveBeenCalledWith(expect.stringContaining("keychain"));
        });

        it('should NOT show a Notice if API key is simply missing (empty settings)', async () => {
            mockSettings.googleApiKey = '';

            await service.generateContent('test').catch(() => { });

            expect(Notice).not.toHaveBeenCalled();
        });

        it('should NOT show a Notice if using a raw AIza key', async () => {
            mockSettings.googleApiKey = 'AIzaRawKey';

            await service.generateContent('test').catch(() => { });

            expect(Notice).not.toHaveBeenCalled();
        });
    });
});
