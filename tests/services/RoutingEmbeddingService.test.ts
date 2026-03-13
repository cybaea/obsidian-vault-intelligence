/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking private methods for unit testing provider routing */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking private methods for unit testing provider routing */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking private methods for unit testing provider routing */
 
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from "../../src/services/GeminiProvider";
import { RoutingEmbeddingService } from "../../src/services/RoutingEmbeddingService";
import { VaultIntelligenceSettings, IVaultIntelligencePlugin } from "../../src/settings/types";

vi.mock("../../src/services/GeminiProvider");
vi.mock("../../src/services/LocalEmbeddingService");
vi.mock("../../src/services/OllamaProvider");

interface RoutingEmbeddingServicePrivates {
    geminiService: GeminiProvider;
    localService: any;
    ollamaService: any;
}

describe('RoutingEmbeddingService', () => {
    let service: RoutingEmbeddingService;
    let mockGemini: GeminiProvider;
    let mockSettings: VaultIntelligenceSettings;
    let mockPlugin: IVaultIntelligencePlugin;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            embeddingDimension: 256,
            embeddingModel: 'local/MinishLab/potion-base-8M'
        } as unknown as VaultIntelligenceSettings;
        mockGemini = {} as unknown as GeminiProvider;
        mockPlugin = { app: {
            plugins: {
                plugins: {
                    "obsidian-vault-intelligence": {
                        manifest: { version: "1.0.0" }
                    }
                }
            }
        } } as unknown as IVaultIntelligencePlugin;
        service = new RoutingEmbeddingService(mockPlugin, mockGemini, mockSettings);
    });

    it('should route local/* to localService', async () => {
        const privates = service as unknown as RoutingEmbeddingServicePrivates;
        const localService = privates.localService;
        localService.embedQuery = vi.fn().mockResolvedValue({ tokenCount: 1, vector: [1, 2] });
        
        await service.embedQuery("test");
        expect(localService.embedQuery).toHaveBeenCalled();
    });

    it('should route ollama/* to ollamaService', async () => {
        mockSettings.embeddingModel = 'ollama/llama3';
        const privates = service as unknown as RoutingEmbeddingServicePrivates;
        const ollamaService = privates.ollamaService;
        ollamaService.embedQuery = vi.fn().mockResolvedValue({ tokenCount: 1, vector: [1, 2] });
        
        await service.embedQuery("test");
        expect(ollamaService.embedQuery).toHaveBeenCalled();
    });

    it('should route gemini-* to geminiService', async () => {
        mockSettings.embeddingModel = 'gemini-embedding-001';
        const privates = service as unknown as RoutingEmbeddingServicePrivates;
        const geminiService = privates.geminiService;
        (geminiService as any).embedQuery = vi.fn().mockResolvedValue({ tokenCount: 1, vector: [1, 2] });
        
        await service.embedQuery("test");
        expect((geminiService as any).embedQuery).toHaveBeenCalled();
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of private method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of private method mocking */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of private method mocking */
 
