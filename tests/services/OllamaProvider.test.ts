/* eslint-disable @typescript-eslint/no-explicit-any -- Required */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Required */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Required */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Required */
import { requestUrl, type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ModelRegistry } from '../../src/services/ModelRegistry';
import { OllamaProvider } from '../../src/services/OllamaProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';
import { type ChatOptions } from '../../src/types/providers';

vi.mock('obsidian', () => ({
    Platform: { isDesktopApp: true },
    requestUrl: vi.fn()
}));

vi.mock('../../src/services/ModelRegistry', () => ({
    ModelRegistry: {
        fetchOllamaModelDetails: vi.fn(),
        getModelById: vi.fn().mockReturnValue({ id: 'ollama/llama3', provider: 'ollama' }),
        resolveContextBudget: vi.fn().mockReturnValue(4096)
    }
}));

interface SecretStorage {
    getSecret: Mock;
    listSecrets: Mock;
    setSecret: Mock;
}

interface MockApp extends App {
    secretStorage: SecretStorage;
}

describe('OllamaProvider', () => {
    let mockApp: MockApp;
    let mockSettings: VaultIntelligenceSettings;
    let provider: OllamaProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockApp = {
            secretStorage: {
                getSecret: vi.fn(),
                listSecrets: vi.fn(),
                setSecret: vi.fn()
            }
        } as unknown as MockApp;

        mockSettings = {
            chatModel: 'ollama/llama3',
            embeddingDimension: 768,
            embeddingModel: 'ollama/nomic-embed-text',
            ollamaEndpoint: 'http://localhost:11434',
            ollamaHeaders: JSON.stringify({
                'Authorization': 'vi-secret:my-token',
                'X-Custom-Plain': 'plain-value'
            })
        } as unknown as VaultIntelligenceSettings;

        provider = new OllamaProvider(mockSettings, mockApp);
    });

    describe('getOllamaHeaders', () => {
        it('should resolve and cache headers', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('secret-token-123');

            const headers = await (provider as any).getOllamaHeaders();

            expect(headers).toEqual({
                'Authorization': 'secret-token-123',
                'X-Custom-Plain': 'plain-value'
            });

            expect(mockApp.secretStorage.getSecret).toHaveBeenCalledWith('ollama-headers-my-token');

            // Second call should be cached
            const headers2 = await (provider as any).getOllamaHeaders();
            expect(headers2).toBe(headers);
            expect(mockApp.secretStorage.getSecret).toHaveBeenCalledTimes(1);
        });

        it('should extract basic auth from endpoint URL', async () => {
            mockSettings.ollamaEndpoint = 'http://user:pass@localhost:11434';
            mockSettings.ollamaHeaders = undefined;
            
            const headers = await (provider as any).getOllamaHeaders();
            
            expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz'); // btoa('user:pass')
        });

        it('should filter restricted headers', async () => {
            mockSettings.ollamaHeaders = JSON.stringify({
                'Host': 'injected.com',
                'X-Valid': 'ok'
            });

            const headers = await (provider as any).getOllamaHeaders();
            
            expect(headers['X-Valid']).toBe('ok');
            expect(headers['Host']).toBeUndefined();
        });
    });

    describe('Integration in network calls', () => {
        it('should include headers in embedChunks', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { embeddings: [[0.1, 0.2]] },
                status: 200
            });

            await provider.embedChunks(['test']);

            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'token123',
                    'X-Custom-Plain': 'plain-value'
                })
            }));
        });

        it('should include headers in generateMessage', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({
                json: { message: { content: 'hello' } },
                status: 200
            });
            (ModelRegistry.fetchOllamaModelDetails as Mock).mockResolvedValue({
                supportedMethods: ['nativeTools']
            });

            await provider.generateMessage([{ content: 'hi', role: 'user' }], {} as ChatOptions);

            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'token123'
                })
            }));
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- end */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- end */
/* eslint-enable @typescript-eslint/no-unsafe-call -- end */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- end */