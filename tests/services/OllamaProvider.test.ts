import { requestUrl, type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ModelRegistry } from '../../src/services/ModelRegistry';
import { OllamaProvider } from '../../src/services/OllamaProvider';
import { VaultIntelligenceSettings } from '../../src/settings/types';
import { ProviderError } from '../../src/types/providers';

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

interface MockApp {
    secretStorage: {
        getSecret: Mock;
        listSecrets: Mock;
        setSecret: Mock;
    };
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
        };

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

        provider = new OllamaProvider(mockSettings, mockApp as unknown as App);
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

            await provider.generateMessage([{ content: 'hi', role: 'user' }], {});

            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'token123'
                })
            }));
        });
    });

    /**
     * Embed status handling: `throw: false` on both `/api/embed` calls keeps
     * the crafted status branches reachable in production, matching the
     * `OpenAICompatProvider` embeddings path.
     */
    describe('embed status branches are reachable', () => {
        it('should reach the status branch on a resolved 4xx in embedChunks', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({ status: 404 });

            const error = await provider.embedChunks(['one']).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(ProviderError);
            expect((error as ProviderError).status).toBe(404);
            expect((error as ProviderError).message).toContain('404');

            // The status mapping relies on requestUrl resolving 4xx responses;
            // with the default throw: true it would reject before the mapping.
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should surface transport failures from the embedChunks request', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockRejectedValue(new Error('connection refused'));

            // requestUrl still rejects for network-level failures even with throw: false.
            await expect(provider.embedChunks(['one'])).rejects.toThrow('connection refused');
        });

        it('should reach the status branch on a resolved 4xx in embedDocument', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockResolvedValue({ status: 404 });

            const error = await provider.embedDocument('one').catch((e: unknown) => e);

            expect(error).toBeInstanceOf(ProviderError);
            expect((error as ProviderError).status).toBe(404);
            expect((error as ProviderError).message).toContain('404');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should surface transport failures from the embedDocument request', async () => {
            mockApp.secretStorage.getSecret.mockResolvedValue('token123');
            (requestUrl as Mock).mockRejectedValue(new Error('socket hang up'));

            await expect(provider.embedDocument('one')).rejects.toThrow('socket hang up');
        });
    });
});

