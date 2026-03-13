import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../../src/services/GeminiProvider';
import { ProviderRegistry } from '../../src/services/ProviderRegistry';
import { VaultIntelligenceSettings } from '../../src/settings/types';

vi.mock('obsidian');
vi.mock('../../src/services/GeminiProvider');
vi.mock('../../src/services/OllamaProvider');

describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockGemini: GeminiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            chatModel: 'gemini-flash',
        } as unknown as VaultIntelligenceSettings;

        mockApp = {} as unknown as App;
        mockGemini = {} as unknown as GeminiProvider;

        registry = new ProviderRegistry(mockSettings, mockApp, mockGemini);
    });

    describe('Routing Logic', () => {
        it('should route gemini-* models to GeminiProvider', () => {
            const client = registry.getReasoningClient('gemini-flash');
            expect(client).toBe(mockGemini);
        });

        it('should route ollama/* models to OllamaProvider', () => {
            const client = registry.getReasoningClient('ollama/llama3');
            // Testing internal Ollama provider access via getOllamaProvider helper
            expect(client).toBe(registry.getOllamaProvider());
        });

        it('should use default model from settings if none provided', () => {
            mockSettings.chatModel = 'ollama/llama3';
            const client = registry.getReasoningClient();
            expect(client).toBe(registry.getOllamaProvider());
        });
    });

    describe('Validation', () => {
        it('should throw ProviderError if no model is selected', () => {
            mockSettings.chatModel = '';
            expect(() => registry.getReasoningClient()).toThrow("No model selected");
        });
    });
});
