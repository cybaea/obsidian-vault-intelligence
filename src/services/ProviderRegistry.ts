import { App } from "obsidian";

import { VaultIntelligenceSettings } from "../settings/types";
import { IModelProvider, IReasoningClient, ProviderError } from "../types/providers";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";

/**
 * Registry and router for reasoning providers.
 * Switches between Gemini and Ollama based on model ID namespacing.
 */
export class ProviderRegistry {
    private ollamaProvider: OllamaProvider;

    constructor(private settings: VaultIntelligenceSettings, private app: App, private geminiProvider: GeminiProvider) {
        this.ollamaProvider = new OllamaProvider(settings, app);
    }

    /**
     * Gets the reasoning client for the requested model.
     * Models starting with 'ollama/' are routed to OllamaProvider.
     */
    public getReasoningClient(modelId?: string): IReasoningClient {
        const id = modelId || this.settings.chatModel;
        if (!id) {
            throw new ProviderError("No model selected. Please select a model in settings.", "ollama"); 
        }
        if (id.startsWith("ollama/")) {
            return this.ollamaProvider;
        }
        return this.geminiProvider;
    }

    /**
     * Gets the capability provider for the requested model.
     */
    public getModelProvider(modelId?: string): IModelProvider {
        const id = modelId || this.settings.chatModel;
        if (!id) {
            throw new ProviderError("No model selected. Please select a model in settings.", "ollama");
        }
        if (id.startsWith("ollama/")) {
            return this.ollamaProvider;
        }
        return this.geminiProvider;
    }

    /**
     * Direct access to the Gemini provider for specific features (like grounding).
     */
    public getGeminiProvider(): GeminiProvider {
        return this.geminiProvider;
    }
    
    /**
     * Direct access to the Ollama provider.
     */
    public getOllamaProvider(): OllamaProvider {
        return this.ollamaProvider;
    }
}
