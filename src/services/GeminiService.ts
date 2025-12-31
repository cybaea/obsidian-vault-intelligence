import {
    GoogleGenerativeAI,
    GenerativeModel,
    TaskType,
    Tool,
    Content,
    EmbedContentRequest
} from "@google/generative-ai";
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

    public async startChat(history: Content[], tools?: Tool[]) {
        // Note: startChat is synchronous in the SDK, but we wrap it in retryOperation 
        // for consistency if it ever needs to be async or handles initial token/auth checks.
        return this.retryOperation(async () => {
            if (!this.chatModel) throw new Error("Chat model not initialized.");
            const chat = this.chatModel.startChat({
                history: history,
                tools: tools
            });
            return await Promise.resolve(chat);
        });
    }

    public async embedText(text: string, options: EmbedOptions = {}): Promise<number[]> {
        return this.retryOperation(async () => {
            if (!this.embeddingModel) throw new Error("Embedding model not initialized.");

            // For now, assuming it's a valid property on EmbedContentRequest for the target environment.
            const request: EmbedContentRequest & { outputDimensionality?: number } = {
                content: { role: 'user', parts: [{ text }] },
            };
            if (options.outputDimensionality) {
                request.outputDimensionality = options.outputDimensionality;
            } else {
                request.outputDimensionality = 768; // Default to 768 if not specified
            }

            if (options.taskType) request.taskType = options.taskType;
            if (options.title) request.title = options.title;

            const result = await this.embeddingModel.embedContent(request);
            return result.embedding.values;
        });
    }

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.settings.geminiRetries, contentWindow: number = 0): Promise<T> {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error: unknown) {
                const isRateLimit = error instanceof Error &&
                    (error.message.includes("429") || (error as { status?: number }).status === 429);

                if (isRateLimit) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    logger.warn(`Rate limited (429). Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
        throw new Error("Max retries reached.");
    }
}