import { VaultIntelligenceSettings } from "../settings";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";

export class GeminiEmbeddingService implements IEmbeddingService {
    private gemini: GeminiService;
    private settings: VaultIntelligenceSettings;

    constructor(gemini: GeminiService, settings: VaultIntelligenceSettings) {
        this.gemini = gemini;
        this.settings = settings;
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    async embedQuery(text: string, _priority?: EmbeddingPriority): Promise<{ vector: number[], tokenCount: number }> {
        const { tokenCount, values } = await this.gemini.embedText(text, {
            taskType: "RETRIEVAL_QUERY"
        });
        return { tokenCount, vector: values };
    }

    async embedDocument(text: string, title?: string, _priority?: EmbeddingPriority): Promise<{ vectors: number[][], tokenCount: number }> {
        // The Gemini API handles long text/chunking internally.
        const { tokenCount, values } = await this.gemini.embedText(text, {
            taskType: "RETRIEVAL_DOCUMENT",
            title: title
        });
        return { tokenCount, vectors: [values] };
    }
}
