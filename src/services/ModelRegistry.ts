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
    static getDefaultModel(type: 'chat' | 'grounding' | 'embedding', provider: 'gemini' | 'local' = 'gemini'): string {
        let models: ModelDefinition[] = [];
        if (type === 'chat') models = GEMINI_CHAT_MODELS;
        else if (type === 'grounding') models = GEMINI_GROUNDING_MODELS;
        else if (type === 'embedding') {
            models = provider === 'gemini' ? GEMINI_EMBEDDING_MODELS : LOCAL_EMBEDDING_MODELS;
        }

        return models.find(m => m.isDefault)?.id || models[0]?.id || '';
    }

    static getModelById(id: string): ModelDefinition | undefined {
        return [
            ...GEMINI_CHAT_MODELS,
            ...GEMINI_GROUNDING_MODELS,
            ...LOCAL_EMBEDDING_MODELS,
            ...GEMINI_EMBEDDING_MODELS
        ].find(m => m.id === id);
    }
}
