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

    async embedQuery(text: string, _priority?: EmbeddingPriority): Promise<number[]> {
        return this.gemini.embedText(text, {
            taskType: "RETRIEVAL_QUERY"
        });
    }

    async embedDocument(text: string, title?: string, _priority?: EmbeddingPriority): Promise<number[][]> {
        // The Gemini API handles long text/chunking internally.
        const vector = await this.gemini.embedText(text, {
            taskType: "RETRIEVAL_DOCUMENT",
            title: title
        });
        return [vector];
    }
}
