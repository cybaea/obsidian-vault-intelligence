/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking private static methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking private static methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking private static methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking private static methods for unit testing adaptation logic */
import { requestUrl } from 'obsidian';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

import { ModelRegistry } from '../../src/services/ModelRegistry';
import { VaultIntelligenceSettings } from '../../src/settings/types';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        requestUrl: vi.fn(),
    };
});

describe('ModelRegistry', () => {
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            ollamaEndpoint: 'http://localhost:11434',
        } as unknown as VaultIntelligenceSettings;
    });

    describe('fetchOllamaModels (O1 Discovery)', () => {
        it('should correctly classify Ollama models by family', async () => {
            const mockTags = {
                models: [
                    {
                        details: { family: 'llama' },
                        name: 'llama3:latest'
                    },
                    {
                        details: { family: 'nomic' },
                        name: 'nomic-embed-text:latest'
                    }
                ]
            };

            (requestUrl as Mock).mockResolvedValue({
                json: mockTags,
                status: 200
            });

            // Use any cast locally for private static method access
            const modelRegistry = ModelRegistry as any;
            const models = await modelRegistry.fetchOllamaModels(mockSettings.ollamaEndpoint);
            
            expect(models).toHaveLength(2);
            
            const llama = models.find((m: any) => m.id === 'ollama/llama3:latest');
            expect(llama?.supportedMethods).toContain('generateContent');
            expect(llama?.provider).toBe('ollama');

            const nomic = models.find((m: any) => m.id === 'ollama/nomic-embed-text:latest');
            expect(nomic?.supportedMethods).toContain('embedContent');
            expect(nomic?.provider).toBe('ollama');
        });
    });

    describe('JIT Context Length Extraction', () => {
        it('should fetch model details from /api/show', async () => {
            const mockShowResult = {
                details: { family: 'llama' },
                model_info: {
                    'llama.context_length': 8192
                },
                modelfile: '...',
                parameters: '...',
                template: '...'
            };

            (requestUrl as Mock).mockResolvedValue({
                json: mockShowResult,
                status: 200
            });

            const mockModel = { id: 'ollama/llama3', provider: 'ollama' };
            const modelRegistry = ModelRegistry as any;
            modelRegistry.getModelById = vi.fn().mockReturnValue(mockModel);

            const details = await ModelRegistry.fetchOllamaModelDetails(mockSettings.ollamaEndpoint, 'ollama/llama3');
            
            expect(details?.inputTokenLimit).toBe(8192);
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of private static method mocking */
