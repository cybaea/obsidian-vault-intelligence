import { App } from "obsidian";

import { OPENAI_COMPAT_MODEL_PREFIX } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { IModelProvider, IReasoningClient, ProviderError } from "../types/providers";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/**
 * Registry and router for reasoning providers.
 * Switches between Gemini, Ollama, and OpenAI-compatible endpoints based on model ID namespacing.
 */
export class ProviderRegistry {
    private ollamaProvider: OllamaProvider;
    private openaiCompatProvider: OpenAICompatProvider;

    constructor(private settings: VaultIntelligenceSettings, private app: App, private geminiProvider: GeminiProvider) {
        this.ollamaProvider = new OllamaProvider(settings, app);
        this.openaiCompatProvider = new OpenAICompatProvider(settings, app);
    }

    /**
     * Gets the reasoning client for the requested model.
     * Models starting with 'ollama/' are routed to OllamaProvider.
     * Models starting with 'openai-compat/' are routed to OpenAICompatProvider.
     */
    public getReasoningClient(modelId?: string): IReasoningClient {
        const id = modelId || this.settings.chatModel;
        if (!id) {
            throw new ProviderError("No model selected. Please select a model in settings.", "ollama"); 
        }
        if (id.startsWith("ollama/")) {
            return this.ollamaProvider;
        }
        if (id.startsWith(OPENAI_COMPAT_MODEL_PREFIX)) {
            return this.openaiCompatProvider;
        }
        if (id.startsWith("voyage/")) {
            // Voyage is embedding only. Fallback to Gemini for reasoning if a Voyage model is somehow passed here.
            return this.geminiProvider;
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
        if (id.startsWith(OPENAI_COMPAT_MODEL_PREFIX)) {
            return this.openaiCompatProvider;
        }
        // Voyage is embedding only
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

    /**
     * Direct access to the OpenAI-compatible provider.
     */
    public getOpenAICompatProvider(): OpenAICompatProvider {
        return this.openaiCompatProvider;
    }
}