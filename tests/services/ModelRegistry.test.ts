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
            const result = await modelRegistry.fetchOllamaModels(mockSettings.ollamaEndpoint, { 'X-Custom': 'header' });
            const models = result.models;
            
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ 'X-Custom': 'header' })
            }));
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

            const details = await ModelRegistry.fetchOllamaModelDetails(mockSettings.ollamaEndpoint, 'ollama/llama3', { 'Authorization': 'Bearer test' });
            
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ 'Authorization': 'Bearer test' })
            }));
            expect(details?.inputTokenLimit).toBe(8192);
        });
    });
    describe('resolveContextBudget', () => {
        it('should prioritize explicit user overrides in customMapping', () => {
            const customMapping = { 'ollama/llama3': 16000 };
            const budget = ModelRegistry.resolveContextBudget('ollama/llama3', customMapping, 200000);
            expect(budget).toBe(16000);
        });

        it('should fall back to safe default for local models if no override exists', () => {
            const customMapping = { 'ollama/llama3': 16000 };
            const budget = ModelRegistry.resolveContextBudget('ollama/qwen2', customMapping, 200000);
            expect(budget).toBe(8192); // 8192 is DEFAULT_LOCAL_CONTEXT_TOKENS
        });

        it('should fall back to global basement budget for cloud models if no override exists', () => {
            const customMapping = {};
            const budget = ModelRegistry.resolveContextBudget('gemini-1.5-flash', customMapping, 200000);
            expect(budget).toBe(200000);
        });

        it('should gracefully handle undefined customMapping', () => {
            const budget = ModelRegistry.resolveContextBudget('ollama/qwen2', undefined as any as Record<string, number>, 200000);
            expect(budget).toBe(8192);
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of private static method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of private static method mocking */
