import { App, requestUrl } from "obsidian";

import { MODEL_REGISTRY_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

interface InternalApp {
    loadLocalStorage?(key: string): string | null;
    saveLocalStorage?(key: string, value: string): void;
}

/**
 * Central registry for AI models used by the plugin.
 * Separates model definitions from UI and business logic.
 */

export interface ModelDefinition {
    description?: string;
    dimensions?: number;
    id: string;
    inputTokenLimit?: number;
    isDefault?: boolean;
    label: string;
    outputTokenLimit?: number;
    provider: 'gemini' | 'local' | 'ollama';
    quantized?: boolean;
    supportedMethods?: string[];
}

export interface ModelCache {
    models: ModelDefinition[];
    rawResponse?: GeminiApiResponse;
    timestamp: number;
}

interface GeminiModel {
    description: string;
    displayName: string;
    inputTokenLimit: number;
    name: string;
    outputTokenLimit: number;
    supportedGenerationMethods: string[];
}

interface GeminiApiResponse {
    models: GeminiModel[];
}

interface OllamaModel {
    details: {
        families: string[] | null;
        family?: string;
        format: string;
        parameter_size: string;
        quantization_level: string;
    };
    digest: string;
    modified_at: string;
    name: string;
    size: number;
}

interface OllamaTagsResponse {
    models: OllamaModel[];
}

interface OllamaShowResponse {
    details: {
        families: string[] | null;
        family?: string;
        format: string;
        parameter_size: string;
        quantization_level: string;
    };
    model_info: Record<string, unknown>;
    modelfile: string;
    parameters: string;
    template: string;
}

export const GEMINI_CHAT_MODELS: ModelDefinition[] = [
    {
        description: 'Fast, efficient, and great for most tasks.',
        id: 'gemini-flash-latest',
        inputTokenLimit: MODEL_REGISTRY_CONSTANTS.DEFAULT_TOKEN_LIMIT,
        isDefault: true,
        label: 'Gemini 3 Flash (Default)',
        provider: 'gemini'
    },
    {
        description: 'Maximum intelligence for complex reasoning.',
        id: 'gemini-pro-latest',
        inputTokenLimit: MODEL_REGISTRY_CONSTANTS.DEFAULT_TOKEN_LIMIT,
        label: 'Gemini 3 Pro',
        provider: 'gemini'
    }
];

export const GEMINI_GROUNDING_MODELS: ModelDefinition[] = [
    {
        id: 'gemini-flash-lite-latest',
        inputTokenLimit: MODEL_REGISTRY_CONSTANTS.DEFAULT_TOKEN_LIMIT,
        isDefault: true,
        label: 'Latest release of Gemini Flash-Lite (Default)',
        provider: 'gemini'
    }
];

export const LOCAL_EMBEDDING_MODELS: ModelDefinition[] = [
    {
        dimensions: 256,
        id: 'local/MinishLab/potion-base-8M',
        isDefault: false,
        label: 'Small (Potion-8M English only) - 256d [~15MB]',
        provider: 'local',
        quantized: false
    },
    {
        dimensions: 384,
        id: 'local/Xenova/multilingual-e5-small',
        isDefault: true,
        label: 'Balanced (European languages E5 Small) - 384d [~30MB]',
        provider: 'local'
    },
    {
        dimensions: 1024,
        id: 'local/Xenova/bge-m3',
        isDefault: false,
        label: 'Advanced (BGE M3) - 1024d [~220MB]',
        provider: 'local'
    }
];

export const GEMINI_EMBEDDING_MODELS: ModelDefinition[] = [
    {
        dimensions: 3072,
        id: 'gemini-embedding-001',
        isDefault: false,
        label: 'Gemini Embedding 001 (Advanced) - 3072d',
        provider: 'gemini'
    },
    {
        dimensions: 768,
        id: 'gemini-embedding-001',
        isDefault: true,
        label: 'Gemini Embedding 001 (Standard) - 768d',
        provider: 'gemini'
    }
];

/**
 * Central registry and manager for AI models.
 * Handles fetching, sorting, and default selection of models.
 */
export class ModelRegistry {

    private static dynamicModels: ModelDefinition[] = [];
    private static rawApiResponse: GeminiApiResponse | null = null;
    private static lastFetchTime: number = 0;
    private static isFetching: boolean = false;
    private static CACHE_KEY = 'vault-intelligence-model-cache';

    /**
     * Fetches the list of available Gemini models from the API and caches them.
     * @param app - The Obsidian App instance.
     * @param apiKey - The Google Gemini API key.
     * @param cacheDurationDays - How many days to cache the results for.
     */
    public static async fetchModels(app: App, apiKey: string, cacheDurationDays: number = MODEL_REGISTRY_CONSTANTS.DEFAULT_CACHE_DURATION_DAYS, forceUpdate: boolean = false, throwOnError: boolean = false): Promise<void> {
        if (this.isFetching) return;

        const now = Date.now();
        const cacheDurationMs = cacheDurationDays * 24 * 60 * 60 * 1000;
        
        let geminiModels: ModelDefinition[] = [];
        let ollamaModels: ModelDefinition[] = [];
        let useGeminiCache = false;

        // 1. Check Memory Cache for Gemini
        if (!forceUpdate && this.dynamicModels.length > 0 && (now - this.lastFetchTime < cacheDurationMs)) {
            useGeminiCache = true;
            geminiModels = this.dynamicModels.filter(m => m.provider === 'gemini');
        } else if (!forceUpdate && cacheDurationDays > 0) {
            // 2. Check LocalStorage Cache for Gemini
            const storage = (app as unknown as InternalApp);
            const cached = storage.loadLocalStorage?.(this.CACHE_KEY);
            if (typeof cached === 'string') {
                try {
                    const parsed = JSON.parse(cached) as unknown as ModelCache;
                    if (now - parsed.timestamp < cacheDurationMs) {
                        useGeminiCache = true;
                        geminiModels = parsed.models.filter(m => m.provider === 'gemini');
                        this.lastFetchTime = parsed.timestamp;
                        this.rawApiResponse = parsed.rawResponse || null;
                    }
                } catch (e) {
                    logger.error("Failed to parse model cache", e);
                }
            }
        }

        // 3. Fetch from APIs Independently
        logger.debug("Fetching models from APIs...");
        this.isFetching = true;
        try {
            const plugin = (app as unknown as { plugins: { getPlugin(id: string): { settings: VaultIntelligenceSettings } } }).plugins.getPlugin("vault-intelligence");
            const settings = plugin?.settings;
            if (!settings) throw new Error("Vault Intelligence settings not found during model fetch.");
            
            const tasks: Promise<void>[] = [];

            if (apiKey && !useGeminiCache) {
                tasks.push(
                    this.fetchGeminiModels(apiKey).then(res => {
                        geminiModels = res.models;
                        this.rawApiResponse = res.rawResponse;
                        this.lastFetchTime = Date.now();
                    }).catch(err => {
                        logger.error("Error fetching Gemini models", err);
                        if (throwOnError) throw err;
                        if (geminiModels.length === 0) {
                            geminiModels = [
                                ...GEMINI_CHAT_MODELS,
                                ...GEMINI_GROUNDING_MODELS,
                                ...GEMINI_EMBEDDING_MODELS
                            ];
                        }
                    })
                );
            } else if (!apiKey && !useGeminiCache) {
                geminiModels = [
                    ...GEMINI_CHAT_MODELS,
                    ...GEMINI_GROUNDING_MODELS,
                    ...GEMINI_EMBEDDING_MODELS
                ];
            }

            if (settings.ollamaEndpoint) {
                tasks.push(
                    this.fetchOllamaModels(settings.ollamaEndpoint)
                        .then(models => { ollamaModels = models; })
                        .catch(err => { logger.debug("Ollama models not available", err); })
                );
            }

            await Promise.allSettled(tasks);

            this.dynamicModels = this.sortModels([...geminiModels, ...ollamaModels]);

            if (cacheDurationDays > 0 && !useGeminiCache && apiKey) {
                const cacheData: ModelCache = {
                    models: this.dynamicModels,
                    rawResponse: this.rawApiResponse || undefined,
                    timestamp: this.lastFetchTime
                };
                (app as unknown as InternalApp).saveLocalStorage?.(this.CACHE_KEY, JSON.stringify(cacheData));
            }
            app.workspace.trigger('vault-intelligence:models-updated');
        } finally {
            this.isFetching = false;
        }
    }

    private static async fetchGeminiModels(apiKey: string): Promise<{ models: ModelDefinition[], rawResponse: GeminiApiResponse }> {
        const response = await requestUrl({
            method: 'GET',
            url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        });

        if (response.status !== 200) {
            throw new Error(`Gemini API error ${response.status}`);
        }

        const data = response.json as GeminiApiResponse;
        const models = data.models.map((m: GeminiModel) => ({
            description: m.description,
            id: m.name.replace('models/', ''),
            inputTokenLimit: m.inputTokenLimit,
            label: m.displayName,
            outputTokenLimit: m.outputTokenLimit,
            provider: 'gemini' as const,
            supportedMethods: m.supportedGenerationMethods || []
        }));

        return { models, rawResponse: data };
    }

    private static async fetchOllamaModels(endpoint: string): Promise<ModelDefinition[]> {
        if (!endpoint) return [];
        
        try {
            const response = await requestUrl({
                method: 'GET',
                url: `${endpoint}/api/tags`
            });

            if (response.status !== 200) return [];
            
            const data = response.json as OllamaTagsResponse;
            const models: ModelDefinition[] = (data.models || []).map((m: OllamaModel) => {
                const family = m.details.family?.toLowerCase() || "";
                const families = (m.details.families || []).map(f => f.toLowerCase());
                
                // O(1) synchronous classification using details.family
                // Note: We'll fetch inputTokenLimit JIT later to fix the NaN clamping paradox.
                const lowerName = m.name.toLowerCase();
                const isEmbedding = family.includes('bert') || 
                                   family.includes('nomic') || 
                                   families.some(f => f.includes('bert') || f.includes('nomic')) ||
                                   lowerName.includes('embed') || 
                                   lowerName.includes('bge') ||
                                   lowerName.includes('minilm');

                return {
                    description: `Local model: ${m.name}`,
                    id: `ollama/${m.name}`,
                    label: `${m.name} (Ollama)`,
                    provider: 'ollama' as const,
                    supportedMethods: isEmbedding ? ['embedContent'] : ['generateContent']
                };
            });

            return models;
        } catch (e) {
            logger.debug("Ollama models not available", e);
            return [];
        }
    }

    private static sortModels(models: ModelDefinition[]): ModelDefinition[] {
        return [...models].sort((a, b) => {
            const getScore = (m: ModelDefinition) => {
                const id = m.id.toLowerCase();
                let score = 0;
                if (id.includes('gemini-3')) score += MODEL_REGISTRY_CONSTANTS.SCORES.GEMINI_3;
                else if (id.includes('gemini-2.5')) score += MODEL_REGISTRY_CONSTANTS.SCORES.GEMINI_2_5;
                else if (id.includes('gemini-2')) score += MODEL_REGISTRY_CONSTANTS.SCORES.GEMINI_2;
                else if (id.includes('gemini-1.5')) score += MODEL_REGISTRY_CONSTANTS.SCORES.GEMINI_1_5;
                else if (id.includes('gemini-1.0')) score += MODEL_REGISTRY_CONSTANTS.SCORES.GEMINI_1_0;

                if (id.includes('pro')) score += MODEL_REGISTRY_CONSTANTS.SCORES.PRO_BOOST;
                else if (id.includes('flash')) score += MODEL_REGISTRY_CONSTANTS.SCORES.FLASH_BOOST;
                else if (id.includes('lite')) score += MODEL_REGISTRY_CONSTANTS.SCORES.LITE_BOOST;

                if (id.includes('preview')) score += MODEL_REGISTRY_CONSTANTS.SCORES.PREVIEW_PENALTY;
                if (id.includes('experimental')) score += MODEL_REGISTRY_CONSTANTS.SCORES.EXPERIMENTAL_PENALTY;

                if (!id.includes('preview') && !id.includes('experimental')) {
                    score += MODEL_REGISTRY_CONSTANTS.PRODUCTION_BOOST;
                }

                // Prioritize embedding if it's an embedding request? No, this is general sort.
                if (id.includes('embedding')) score += MODEL_REGISTRY_CONSTANTS.SCORES.EMBEDDING_BOOST;

                return score;
            };

            return getScore(b) - getScore(a);
        });
    }

    /**
     * Returns a list of models suitable for general chat.
     * @returns Array of chat-capable model definitions.
     */
    public static getChatModels(): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_CHAT_MODELS;
        return models.filter(m =>
            (m.provider === 'gemini' || m.provider === 'local' || m.provider === 'ollama') &&
            (m.supportedMethods?.includes('generateContent') || idLooksLikeChat(m.id)) &&
            // Exclude noisy/experimental variants from the main dropdowns
            !m.id.toLowerCase().includes('nano') &&
            !m.id.toLowerCase().includes('experimental')
        );
    }

    /**
     * Returns a list of models suitable for embedding.
     * @param provider - Filter by provider ('gemini' or 'local').
     * @returns Array of embedding model definitions.
     */
    public static getEmbeddingModels(provider: 'gemini' | 'local' | 'ollama' = 'gemini'): ModelDefinition[] {
        if (provider === 'local') return LOCAL_EMBEDDING_MODELS;
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_EMBEDDING_MODELS;
        return models.filter(m =>
            m.provider === provider &&
            (m.supportedMethods?.includes('embedContent') || m.id.includes('embedding'))
        );
    }

    /**
     * Returns a list of models suitable for grounding (search).
     * @returns Array of grounding-capable model definitions.
     */
    public static getGroundingModels(): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_GROUNDING_MODELS;
        // Grounding models are strictly restricted to flash/lite models.
        // These are optimized for tool-use and search grounding where speed/cost is primary.
        return models.filter(m =>
            m.provider === 'gemini' &&
            (m.id.includes('flash') || m.id.includes('lite')) &&
            !m.id.toLowerCase().includes('experimental') &&
            !m.id.toLowerCase().includes('nano')
        );
    }

    /**
     * Gets the default model ID for a specific task.
     * @param type - The task type.
     * @param provider - The provider.
     * @returns The default model ID string.
     */
    public static getDefaultModel(type: 'chat' | 'grounding' | 'embedding', provider: 'gemini' | 'local' | 'ollama' = 'gemini'): string {
        let models: ModelDefinition[] = [];
        if (type === 'chat') models = this.getChatModels();
        else if (type === 'grounding') models = this.getGroundingModels();
        else if (type === 'embedding') models = this.getEmbeddingModels(provider);

        return models.find(m => m.isDefault)?.id || models[0]?.id || '';
    }

    /**
     * Retrieves a model definition by its unique ID.
     * @param id - The model ID string (e.g., 'gemini-1.5-flash').
     * @returns The model definition or undefined if not found in any registry.
     */
    public static getModelById(id: string): ModelDefinition | undefined {
        const dynamic = this.dynamicModels.find(m => m.id === id);
        if (dynamic) return dynamic;

        return [
            ...GEMINI_CHAT_MODELS,
            ...GEMINI_GROUNDING_MODELS,
            ...LOCAL_EMBEDDING_MODELS,
            ...GEMINI_EMBEDDING_MODELS
        ].find(m => m.id === id);
    }

    /**
     * Returns the raw API response for debugging purposes.
     * @returns The GeminiApiResponse object or null.
     */
    public static getRawResponse(): GeminiApiResponse | null {
        return this.rawApiResponse;
    }

    /**
     * Calculates a new budget proportional to the model's total capacity.
     * Prevents context budgets from being nonsensical when switching between
     * models with drastically different limits (e.g. 1M vs 32k).
     * @param currentBudget - The current budget value.
     * @param oldModelId - The ID of the previous model.
     * @param newModelId - The ID of the new model.
     * @returns The newly adjusted budget.
     */
    public static calculateAdjustedBudget(currentBudget: number, oldModelId: string, newModelId: string): number {
        const oldModel = this.getModelById(oldModelId);
        const newModel = this.getModelById(newModelId);

        const isOldLocal = oldModel?.provider === 'ollama' || oldModel?.provider === 'local';
        const isNewLocal = newModel?.provider === 'ollama' || newModel?.provider === 'local';

        // Protection against Cloud -> Local context explosion
        if (isNewLocal && !isOldLocal) {
            return Math.min(currentBudget, 8192); // Safe consumer VRAM default
        } else if (!isNewLocal && isOldLocal) {
            // Revert towards a healthy cloud budget if they had it artificially constrained by local models
            return Math.max(currentBudget, 200000);
        }

        // If either is custom or unknown, we don't have hard data to scale with.
        if (!oldModel?.inputTokenLimit || !newModel?.inputTokenLimit) {
            // Safety fallback for custom unknown local models
            if (isNewLocal) return Math.min(currentBudget, 8192);
            return currentBudget;
        }

        // Safety: ensure currentBudget is within sane bounds before ratio calculation
        // to prevent extreme floating point precision issues.
        const safeCurrent = Math.min(currentBudget, oldModel.inputTokenLimit);

        const ratio = safeCurrent / oldModel.inputTokenLimit;
        const adjusted = Math.floor(ratio * newModel.inputTokenLimit);

        // Safety: Cap at model max, but keep a reasonable floor
        const result = Math.min(newModel.inputTokenLimit, Math.max(MODEL_REGISTRY_CONSTANTS.CONTEXT_ADJUSTMENT_FLOOR, adjusted));

        // Final sanity check for JavaScript's MAX_SAFE_INTEGER
        return Number.isSafeInteger(result) ? result : newModel.inputTokenLimit;
    }

    /**
     * Fetches details for a specific Ollama model JIT.
     * Extracts context length for reasoning models and embedding dimensions for embedding models.
     */
    public static async fetchOllamaModelDetails(endpoint: string, modelId: string): Promise<ModelDefinition | undefined> {
        const cleanId = modelId.replace('ollama/', '');
        try {
            const response = await requestUrl({
                body: JSON.stringify({ name: cleanId }),
                method: 'POST',
                url: `${endpoint}/api/show`
            });

            if (response.status !== 200) return undefined;

            const details = response.json as OllamaShowResponse;
            const model = this.getModelById(modelId);
            if (!model) return undefined;

            // Extract Context Length
            const ctx = (details.model_info?.["llama.context_length"] as number) || 
                        (details.model_info?.["phi3.context_length"] as number) || 
                        (details.model_info?.["qwen2.context_length"] as number) || 
                        (details.model_info?.["context_length"] as number) || 4096;
            
            model.inputTokenLimit = ctx;

            // Extract Embedding Dimensions
            const arch = details.details.family || (Object.keys(details.model_info || {})[0]?.split('.')[0]);
            const dim = (details.model_info?.[`${arch}.embedding_length`] as number) || 
                        (details.model_info?.["embedding_length"] as number);
            
            if (dim) model.dimensions = dim;

            // Extract Native Tool Support
            const template = details.template || "";
            if (template.includes(".Tools") || template.includes(".tools")) {
                if (model.supportedMethods && !model.supportedMethods.includes('nativeTools')) {
                    model.supportedMethods.push('nativeTools');
                } else if (!model.supportedMethods) {
                    model.supportedMethods = ['nativeTools'];
                }
            }

            return model;
        } catch (e) {
            logger.error(`Failed to fetch JIT details for ${modelId}`, e);
            return undefined;
        }
    }
}

function idLooksLikeChat(id: string): boolean {
    const lower = id.toLowerCase();
    const isGeminiChat = lower.includes('gemini') && !lower.includes('embedding') && !lower.includes('aqa');
    const isOllamaChat = lower.startsWith('ollama/') && !lower.includes('embed') && !lower.includes('bge'); 
    return isGeminiChat || isOllamaChat;
}
