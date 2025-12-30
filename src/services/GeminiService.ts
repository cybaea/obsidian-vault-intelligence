import { GoogleGenerativeAI, GenerativeModel, TaskType, Tool, Content, EmbedContentRequest } from "@google/generative-ai";
import { VaultIntelligenceSettings } from "../settings";
import { logger } from "../utils/logger";


export interface EmbedOptions {
    taskType?: TaskType;
    title?: string;
    outputDimensionality?: number;
}

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private embeddingModel: GenerativeModel;
    private chatModel: GenerativeModel;
    private settings: VaultIntelligenceSettings;

    constructor(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.initialize();
    }

    public initialize() {
        if (!this.settings.googleApiKey) {
            logger.warn("Google API Key is missing.");
            return;
        }

        try {
            this.genAI = new GoogleGenerativeAI(this.settings.googleApiKey);
            this.embeddingModel = this.genAI.getGenerativeModel({ model: this.settings.embeddingModel });
            this.chatModel = this.genAI.getGenerativeModel({ model: this.settings.chatModel });
            logger.info("GeminiService initialized.");
        } catch (error) {
            logger.error("Failed to initialize GeminiService:", error);
        }
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.initialize();
    }

    public isReady(): boolean {
        return !!this.embeddingModel && !!this.chatModel;
    }

    public getEmbeddingModelName(): string {
        return this.settings.embeddingModel;
    }

    public async generateContent(prompt: string): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.chatModel) throw new Error("Chat model not initialized.");
            const result = await this.chatModel.generateContent(prompt);
            return result.response.text();
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async streamContent(prompt: string): Promise<any> {
        return this.retryOperation(async () => {
            if (!this.chatModel) throw new Error("Chat model not initialized.");
            const result = await this.chatModel.generateContentStream(prompt);
            return result.stream;
        });
    }

    public async startChat(history: Content[], tools?: Tool[]) {
        return this.retryOperation(async () => {
            if (!this.chatModel) throw new Error("Chat model not initialized.");
            return this.chatModel.startChat({
                history: history,
                tools: tools
            });
        });
    }

    public async embedText(text: string, options: EmbedOptions = {}): Promise<number[]> {
        return this.retryOperation(async () => {
            if (!this.embeddingModel) throw new Error("Embedding model not initialized.");

            const request: EmbedContentRequest = {
                content: { role: 'user', parts: [{ text }] },
            };

            if (options.taskType) request.taskType = options.taskType;
            if (options.title) request.title = options.title;

            // Critical: Force 768 dimensions if not specified, to match VectorStore expectation
            // The outputDimensionality property is part of the EmbedContentRequest in newer versions of the SDK
            // or when using specific embedding models that support it.
            // If your SDK version or model does not directly support it on EmbedContentRequest,
            // you might need to pass it via a model configuration object if available,
            // or keep the `as any` cast if it's a known undocumented feature.
            // For now, assuming it's a valid property on EmbedContentRequest for the target environment.
            if (options.outputDimensionality) {
                /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
                (request as any).outputDimensionality = options.outputDimensionality;
            } else {
                (request as any).outputDimensionality = 768; // Default to 768 if not specified
                /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
            }

            const result = await this.embeddingModel.embedContent(request);
            return result.embedding.values;
        });
    }

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.settings.geminiRetries, contentWindow: number = 0): Promise<T> {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error: unknown) {
                /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
                if (error instanceof Error && (error.message.includes("429") || (error as any).status === 429)) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    logger.warn(`Rate limited (429). Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
                /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
            }
        }
        throw new Error("Max retries reached.");
    }
}
