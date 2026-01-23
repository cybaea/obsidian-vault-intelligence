import { App } from "obsidian";

interface InternalApp {
    loadLocalStorage?(key: string): string | null;
    saveLocalStorage?(key: string, value: string): void;
}

/**
 * Central registry for AI models used by the plugin.
 * Separates model definitions from UI and business logic.
 */

export interface ModelDefinition {
    id: string;
    label: string;
    dimensions?: number;
    provider: 'gemini' | 'local';
    description?: string;
    isDefault?: boolean;
    quantized?: boolean;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedMethods?: string[];
}

export interface ModelCache {
    timestamp: number;
    models: ModelDefinition[];
}

interface GeminiModel {
    name: string;
    displayName: string;
    description: string;
    inputTokenLimit: number;
    outputTokenLimit: number;
    supportedGenerationMethods: string[];
}

interface GeminiApiResponse {
    models: GeminiModel[];
}

export const GEMINI_CHAT_MODELS: ModelDefinition[] = [
    {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (Default)',
        provider: 'gemini',
        isDefault: true,
        description: 'Fast, efficient, and great for most tasks.'
    },
    {
        id: 'gemini-3-pro-preview',
        label: 'Gemini 3 Pro',
        provider: 'gemini',
        description: 'Maximum intelligence for complex reasoning.'
    }
];

export const GEMINI_GROUNDING_MODELS: ModelDefinition[] = [
    {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite (Default)',
        provider: 'gemini',
        isDefault: true
    }
];

export const LOCAL_EMBEDDING_MODELS: ModelDefinition[] = [
    {
        id: 'MinishLab/potion-base-8M',
        label: 'Small (Potion-8M) - 256d [~15MB]',
        dimensions: 256,
        provider: 'local',
        isDefault: false,
        quantized: false
    },
    {
        id: 'Xenova/bge-small-en-v1.5',
        label: 'Balanced (BGE-Small) - 384d [~30MB]',
        dimensions: 384,
        provider: 'local',
        isDefault: true
    },
    {
        id: 'Xenova/nomic-embed-text-v1',
        label: 'Advanced (Nomic-Embed) - 768d [~130MB]',
        dimensions: 768,
        provider: 'local',
        isDefault: false
    }
];

export const GEMINI_EMBEDDING_MODELS: ModelDefinition[] = [
    {
        id: 'gemini-embedding-001',
        label: 'Gemini Embedding (Standard) - 768d',
        dimensions: 768,
        provider: 'gemini',
        isDefault: true
    }
];

export class ModelRegistry {
    private static dynamicModels: ModelDefinition[] = [];
    private static lastFetchTime: number = 0;
    private static CACHE_KEY = 'vault-intelligence-model-cache';

    static async fetchModels(app: App, apiKey: string, cacheDurationDays: number = 7): Promise<void> {
        if (!apiKey) return;

        // 1. Check Memory Cache
        const now = Date.now();
        const cacheDurationMs = cacheDurationDays * 24 * 60 * 60 * 1000;

        if (this.dynamicModels.length > 0 && (now - this.lastFetchTime < cacheDurationMs)) {
            return;
        }

        // 2. Check LocalStorage Cache
        if (cacheDurationDays > 0) {
            const storage = (app as unknown as InternalApp); // Access internal storage methods
            const cached = storage.loadLocalStorage?.(this.CACHE_KEY);
            if (typeof cached === 'string') {
                try {
                    const parsed = JSON.parse(cached) as unknown as ModelCache;
                    if (now - parsed.timestamp < cacheDurationMs) {
                        this.dynamicModels = parsed.models;
                        this.lastFetchTime = parsed.timestamp;
                        return;
                    }
                } catch (e) {
                    console.error("Failed to parse model cache", e);
                }
            }
        }

        // 3. Fetch from API
        try {
            const { requestUrl } = await import("obsidian");
            const response = await requestUrl({
                url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                method: 'GET'
            });

            if (response.status !== 200) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = response.json as GeminiApiResponse;
            const fetchedModels: ModelDefinition[] = data.models.map((m: GeminiModel) => ({
                id: m.name.replace('models/', ''),
                label: m.displayName,
                provider: 'gemini',
                description: m.description,
                inputTokenLimit: m.inputTokenLimit,
                outputTokenLimit: m.outputTokenLimit,
                supportedMethods: m.supportedGenerationMethods || []
            }));

            this.dynamicModels = this.sortModels(fetchedModels);
            this.lastFetchTime = Date.now();

            if (cacheDurationDays > 0) {
                const cacheData: ModelCache = {
                    timestamp: this.lastFetchTime,
                    models: this.dynamicModels
                };
                (app as unknown as InternalApp).saveLocalStorage?.(this.CACHE_KEY, JSON.stringify(cacheData));
            }
        } catch (error) {
            console.error("Error fetching Gemini models:", error);
            // Fallback to hardcoded if fetch fails and no cache
            if (this.dynamicModels.length === 0) {
                this.dynamicModels = [
                    ...GEMINI_CHAT_MODELS,
                    ...GEMINI_GROUNDING_MODELS,
                    ...GEMINI_EMBEDDING_MODELS
                ];
            }
        }
    }

    private static sortModels(models: ModelDefinition[]): ModelDefinition[] {
        return [...models].sort((a, b) => {
            const getScore = (m: ModelDefinition) => {
                const id = m.id.toLowerCase();
                let score = 0;
                if (id.includes('gemini-3')) score += 4000;
                else if (id.includes('gemini-2.5')) score += 3000;
                else if (id.includes('gemini-2')) score += 2500;
                else if (id.includes('gemini-1.5')) score += 2000;
                else if (id.includes('gemini-1.0')) score += 1000;

                if (id.includes('pro')) score += 500;
                else if (id.includes('flash')) score += 300;
                else if (id.includes('lite')) score += 100;

                if (!id.includes('preview') && !id.includes('experimental')) score += 50;

                // Prioritize embedding if it's an embedding request? No, this is general sort.
                if (id.includes('embedding')) score += 10;

                return score;
            };

            return getScore(b) - getScore(a);
        });
    }

    static getChatModels(): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_CHAT_MODELS;
        return models.filter(m =>
            m.provider === 'gemini' &&
            (m.supportedMethods?.includes('generateContent') || idLooksLikeChat(m.id))
        );
    }

    static getEmbeddingModels(provider: 'gemini' | 'local' = 'gemini'): ModelDefinition[] {
        if (provider === 'local') return LOCAL_EMBEDDING_MODELS;
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_EMBEDDING_MODELS;
        return models.filter(m =>
            m.provider === 'gemini' &&
            (m.supportedMethods?.includes('embedContent') || m.id.includes('embedding'))
        );
    }

    static getGroundingModels(): ModelDefinition[] {
        const models = this.dynamicModels.length > 0 ? this.dynamicModels : GEMINI_GROUNDING_MODELS;
        // Grounding models are usually flash/lite models that support tools
        return models.filter(m =>
            m.provider === 'gemini' &&
            (m.id.includes('flash') || m.id.includes('lite'))
        );
    }

    static getDefaultModel(type: 'chat' | 'grounding' | 'embedding', provider: 'gemini' | 'local' = 'gemini'): string {
        let models: ModelDefinition[] = [];
        if (type === 'chat') models = this.getChatModels();
        else if (type === 'grounding') models = this.getGroundingModels();
        else if (type === 'embedding') models = this.getEmbeddingModels(provider);

        return models.find(m => m.isDefault)?.id || models[0]?.id || '';
    }

    static getModelById(id: string): ModelDefinition | undefined {
        const dynamic = this.dynamicModels.find(m => m.id === id);
        if (dynamic) return dynamic;

        return [
            ...GEMINI_CHAT_MODELS,
            ...GEMINI_GROUNDING_MODELS,
            ...LOCAL_EMBEDDING_MODELS,
            ...GEMINI_EMBEDDING_MODELS
        ].find(m => m.id === id);
    }
}

function idLooksLikeChat(id: string): boolean {
    const lower = id.toLowerCase();
    return lower.includes('gemini') && !lower.includes('embedding') && !lower.includes('aqa');
}
