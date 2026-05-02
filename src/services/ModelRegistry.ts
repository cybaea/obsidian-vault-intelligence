import { App, requestUrl } from "obsidian";

import { MODEL_REGISTRY_CONSTANTS, SANITIZATION_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

// Removed InternalApp requirement

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
    supportsNativeSearch?: boolean;
    supportsUrlContext?: boolean;
}

export interface ModelCache {
    models: ModelDefinition[];
    rawOllamaResponse?: OllamaTagsResponse | null;
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
        inputTokenLimit: SANITIZATION_CONSTANTS.MAX_TOKEN_LIMIT_SANITY,
        isDefault: true,
        label: 'Gemini 3 Flash (Default)',
        provider: 'gemini',
        supportsNativeSearch: true,
        supportsUrlContext: true
    },
    {
        description: 'Maximum intelligence for complex reasoning.',
        id: 'gemini-pro-latest',
        inputTokenLimit: SANITIZATION_CONSTANTS.MAX_TOKEN_LIMIT_SANITY,
        label: 'Gemini 3 Pro',
        provider: 'gemini',
        supportsNativeSearch: true,
        supportsUrlContext: true
    }
];

export const GEMINI_GROUNDING_MODELS: ModelDefinition[] = [
    {
        id: 'gemini-flash-lite-latest',
        inputTokenLimit: SANITIZATION_CONSTANTS.MAX_TOKEN_LIMIT_SANITY,
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
    private static rawOllamaResponse: OllamaTagsResponse | null = null;
    private static lastFetchTime: number = 0;
    private static isFetching: boolean = false;
    private static ollamaDetailsCache = new Set<string>();
    private static getCachePath(app: App, pluginDir: string): string {
        const dir = pluginDir || `${app.vault.configDir}/plugins/vault-intelligence`;
        return `${dir}/model-cache.json`;
    }

    /**
     * Fetches the list of available Gemini models from the API and caches them.
     * @param app - The Obsidian App instance.
     * @param apiKey - The Google Gemini API key.
     * @param cacheDurationDays - How many days to cache the results for.
     */
    public static async fetchModels(
        app: App, 
        pluginDir: string, 
        settings: VaultIntelligenceSettings, 
        apiKey: string, 
        cacheDurationDays: number = MODEL_REGISTRY_CONSTANTS.DEFAULT_CACHE_DURATION_DAYS, 
        forceUpdate: boolean = false, 
        throwOnError: boolean = false, 
        skipOllamaFetch: boolean = false,
        ollamaHeaders: Record<string, string> = {}
    ): Promise<void> {
        if (this.isFetching) return;

        this.ollamaDetailsCache.clear();

        const now = Date.now();
        const cacheDurationMs = cacheDurationDays * 24 * 60 * 60 * 1000;

        let geminiModels: ModelDefinition[] = [];
        let ollamaModels: ModelDefinition[] = [];
        let useGeminiCache = false;
        let useOllamaCache = false;

        let cachedOllamaModels: ModelDefinition[] | null = null;
        let cachedGeminiModels: ModelDefinition[] | null = null;

        // 1. Check Memory Cache for models first
        if (this.dynamicModels.length > 0) {
            cachedGeminiModels = this.dynamicModels.filter(m => m.provider === 'gemini');
            cachedOllamaModels = this.dynamicModels.filter(m => m.provider === 'ollama');

            if (!forceUpdate && (now - this.lastFetchTime < cacheDurationMs)) {
                useGeminiCache = true;
                useOllamaCache = true;
                geminiModels = cachedGeminiModels;
                ollamaModels = cachedOllamaModels;
            }
        }

        // 2. Check File Cache for models (we ALWAYS load the cached OLLAMA memory as fallback regardless of expiry)
        if (!cachedOllamaModels || !cachedGeminiModels) {
            const cachePath = this.getCachePath(app, pluginDir);
            if (await app.vault.adapter.exists(cachePath)) {
                try {
                    const cached = await app.vault.adapter.read(cachePath);
                    const parsed = JSON.parse(cached) as unknown as ModelCache;
                    cachedGeminiModels = parsed.models.filter(m => m.provider === 'gemini');
                    cachedOllamaModels = parsed.models.filter(m => m.provider === 'ollama');

                    if (!forceUpdate && cacheDurationDays > 0 && (now - parsed.timestamp < cacheDurationMs)) {
                        useGeminiCache = true;
                        useOllamaCache = true;
                        geminiModels = cachedGeminiModels;
                        ollamaModels = cachedOllamaModels;
                        this.lastFetchTime = parsed.timestamp;
                        this.rawApiResponse = parsed.rawResponse || null;
                        this.rawOllamaResponse = parsed.rawOllamaResponse || null;
                    }
                } catch (e) {
                    logger.error("Failed to parse model cache file", e);
                }
            }
        }

        // 3. Fetch from APIs Independently
        logger.debug("Fetching models from APIs...");
        this.isFetching = true;
        try {
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

            if (settings.ollamaEndpoint && !useOllamaCache) {
                if (skipOllamaFetch) {
                    if (cachedOllamaModels) {
                        ollamaModels = cachedOllamaModels;
                        useOllamaCache = true; // Pretend we used cache to prevent saving over it
                    }
                } else {
                    tasks.push(
                        this.fetchOllamaModels(settings.ollamaEndpoint, ollamaHeaders)
                            .then(res => {
                                if (res.success) {
                                    ollamaModels = res.models;
                                    this.rawOllamaResponse = res.rawResponse;
                                } else if (cachedOllamaModels) {
                                    // Fallback to stale cache if server is offline
                                    ollamaModels = cachedOllamaModels;
                                    useOllamaCache = true; // prevent saving over
                                }
                            })
                            .catch(err => {
                                logger.debug("Ollama models not available", err);
                                if (cachedOllamaModels) {
                                    ollamaModels = cachedOllamaModels;
                                    useOllamaCache = true;
                                }
                            })
                    );
                }
            }

            await Promise.allSettled(tasks);

            this.dynamicModels = this.sortModels([...geminiModels, ...ollamaModels]);

            if (settings.modelCacheDurationDays > 0 && (!useGeminiCache || !useOllamaCache) && (apiKey || settings.ollamaEndpoint)) {
                if (this.lastFetchTime === 0) this.lastFetchTime = Date.now();
                const cacheData: ModelCache = {
                    models: this.dynamicModels,
                    rawOllamaResponse: this.rawOllamaResponse || undefined,
                    rawResponse: this.rawApiResponse || undefined,
                    timestamp: this.lastFetchTime
                };
                const cachePath = this.getCachePath(app, pluginDir);
                await app.vault.adapter.write(cachePath, JSON.stringify(cacheData));
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
        const models = data.models.map((m: GeminiModel) => {
            const id = m.name.replace('models/', '');
            let supportsNativeSearch = false;
            let supportsUrlContext = false;

            if (id === 'gemini-flash-latest' || id === 'gemini-pro-latest' || id === 'gemini-flash-lite-latest') {
                supportsNativeSearch = true;
                supportsUrlContext = true;
            } else {
                const match = id.match(/^gemini-([\d.]+)/);
                if (match && match[1]) {
                    const matchStr = match[1];
                    const parts = matchStr.split('.').map(Number);
                    if (parts[0] !== undefined && (parts[0] > 3 || (parts[0] === 3 && (parts[1] || 0) >= 1))) {
                        supportsNativeSearch = true;
                        supportsUrlContext = true;
                    }
                }
            }

            return {
                description: m.description,
                id,
                inputTokenLimit: m.inputTokenLimit,
                label: m.displayName,
                outputTokenLimit: m.outputTokenLimit,
                provider: 'gemini' as const,
                supportedMethods: m.supportedGenerationMethods || [],
                supportsNativeSearch,
                supportsUrlContext
            };
        });

        return { models, rawResponse: data };
    }

    private static async fetchOllamaModels(endpoint: string, headers: Record<string, string> = {}): Promise<{ models: ModelDefinition[], rawResponse: OllamaTagsResponse | null, success: boolean }> {
        if (!endpoint) return { models: [], rawResponse: null, success: false };

        try {
            const response = await requestUrl({
                headers,
                method: 'GET',
                url: `${endpoint}/api/tags`
            });

            if (response.status !== 200) return { models: [], rawResponse: null, success: false };

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

            return { models, rawResponse: data, success: true };
        } catch (e) {
            logger.debug("Ollama models not available", e);
            return { models: [], rawResponse: null, success: false };
        }
    }

    private static sortModels(models: ModelDefinition[]): ModelDefinition[] {
        const filtered = models.filter(m => {
            if (m.provider === 'gemini') {
                if (m.id.match(/^gemini-2\./)) return false;
            }
            return true;
        });

        return filtered.sort((a, b) => {
            const getRank = (m: ModelDefinition) => {
                const id = m.id.toLowerCase();
                if (id.match(/^gemini-.*-latest$/)) return 1;
                if (id.match(/^gemini-embedding-/)) return 2;
                if (id.match(/^gemini-[\d.]+/)) return 3;
                if (id.match(/^gemini-/)) return 4;
                if (id.match(/^gemma-/)) return 5;
                return 6;
            };

            const rankA = getRank(a);
            const rankB = getRank(b);

            if (rankA !== rankB) return rankA - rankB;

            if (rankA === 3) {
                const getVersion = (id: string) => {
                    const match = id.match(/^gemini-([\d.]+)/);
                    if (match && match[1]) {
                        return match[1].split('.').map(Number);
                    }
                    return [];
                };
                const vA = getVersion(a.id.toLowerCase());
                const vB = getVersion(b.id.toLowerCase());

                const len = Math.max(vA.length, vB.length);
                for (let i = 0; i < len; i++) {
                    const numA = i < vA.length ? (vA[i] || 0) : 0;
                    const numB = i < vB.length ? (vB[i] || 0) : 0;
                    if (numA !== numB) return numB - numA;
                }
            }

            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Returns a list of all known models (dynamic + static), primarily for setting filters.
     * @returns Array of all known model definitions.
     */
    public static getAllKnownModels(): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : [
            ...GEMINI_CHAT_MODELS,
            ...GEMINI_GROUNDING_MODELS,
            ...LOCAL_EMBEDDING_MODELS,
            ...GEMINI_EMBEDDING_MODELS
        ];

        // Return a deduplicated list
        const unique = new Map<string, ModelDefinition>();
        models.forEach(m => unique.set(m.id, m));
        return Array.from(unique.values());
    }

    /**
     * Returns a list of models suitable for general chat.
     * @param hiddenModels - Optional list of model IDs to exclude.
     * @returns Array of chat-capable model definitions.
     */
    public static getChatModels(hiddenModels: string[] = []): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_CHAT_MODELS;
        return models.filter(m =>
            (m.provider === 'gemini' || m.provider === 'local' || m.provider === 'ollama') &&
            (m.supportedMethods?.includes('generateContent') || idLooksLikeChat(m.id)) &&
            // Exclude noisy/experimental variants from the main dropdowns
            !m.id.toLowerCase().includes('nano') &&
            !m.id.toLowerCase().includes('experimental') &&
            !hiddenModels.includes(m.id)
        );
    }

    /**
     * Returns a list of models suitable for embedding.
     * @param provider - Filter by provider ('gemini' or 'local').
     * @param hiddenModels - Optional list of model IDs to exclude.
     * @returns Array of embedding model definitions.
     */
    public static getEmbeddingModels(provider: 'gemini' | 'local' | 'ollama' = 'gemini', hiddenModels: string[] = []): ModelDefinition[] {
        if (provider === 'local') return LOCAL_EMBEDDING_MODELS.filter(m => !hiddenModels.includes(m.id));
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_EMBEDDING_MODELS;
        return models.filter(m =>
            m.provider === provider &&
            (m.supportedMethods?.includes('embedContent') || m.id.includes('embedding')) &&
            !hiddenModels.includes(m.id)
        );
    }

    /**
     * Returns a list of models suitable for grounding (search).
     * @param hiddenModels - Optional list of model IDs to exclude.
     * @returns Array of grounding-capable model definitions.
     */
    public static getGroundingModels(hiddenModels: string[] = []): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_GROUNDING_MODELS;
        // Grounding models are strictly restricted to flash/lite models.
        // These are optimized for tool-use and search grounding where speed/cost is primary.
        return models.filter(m =>
            m.provider === 'gemini' &&
            (m.id.includes('flash') || m.id.includes('lite')) &&
            !m.id.toLowerCase().includes('experimental') &&
            !m.id.toLowerCase().includes('nano') &&
            !hiddenModels.includes(m.id)
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
     * Returns the raw API response from Ollama for debugging purposes.
     * @returns The OllamaTagsResponse object or null.
     */
    public static getRawOllamaResponse(): OllamaTagsResponse | null {
        return this.rawOllamaResponse;
    }

    /**
     * Resolves the appropriate context budget for a given model.
     * Prioritizes explicit user overrides, falls back to safe defaults for local models, 
     * and uses the global baseline for cloud providers.
     */
    public static resolveContextBudget(
        modelId: string,
        customMapping: Record<string, number>,
        defaultGlobalBudget: number
    ): number {
        // 1. Highest priority: User explicitly defined an override for this specific model
        if (customMapping && typeof customMapping[modelId] === 'number') {
            return customMapping[modelId];
        }

        // 2. Safe fallback: Local Ollama models (prevent cloud -> local explosion)
        if (modelId.startsWith("ollama/") || modelId.startsWith("local/")) {
            return SANITIZATION_CONSTANTS.DEFAULT_LOCAL_CONTEXT_TOKENS;
        }

        // 3. Baseline: Legacy setting/cloud models
        return defaultGlobalBudget;
    }

    /**
     * Fetches details for a specific Ollama model JIT.
     * Extracts context length for reasoning models and embedding dimensions for embedding models.
     */
    public static async fetchOllamaModelDetails(endpoint: string, modelId: string, headers: Record<string, string> = {}): Promise<ModelDefinition | undefined> {
        const model = this.getModelById(modelId);
        if (!model) return undefined;

        if (this.ollamaDetailsCache.has(modelId)) {
            return model;
        }

        const cleanId = modelId.replace('ollama/', '');
        try {
            const response = await requestUrl({
                body: JSON.stringify({ name: cleanId }),
                headers,
                method: 'POST',
                url: `${endpoint}/api/show`
            });

            if (response.status !== 200) return undefined;

            const details = response.json as OllamaShowResponse;

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

            this.ollamaDetailsCache.add(modelId);
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