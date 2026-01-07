import { IEmbeddingService } from "./IEmbeddingService";
import { GeminiService } from "./GeminiService";
import { VaultIntelligenceSettings } from "../settings";

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

    async embedQuery(text: string): Promise<number[]> {
        return this.gemini.embedText(text, {
            taskType: "RETRIEVAL_QUERY"
        });
    }

    async embedDocument(text: string, title?: string): Promise<number[]> {
        return this.gemini.embedText(text, {
            taskType: "RETRIEVAL_DOCUMENT",
            title: title
        });
    }
}
