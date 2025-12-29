import { GoogleGenerativeAI, GenerativeModel, TaskType, FunctionDeclaration, Tool } from "@google/generative-ai";
import { VaultIntelligenceSettings } from "../settings";
import { logger } from "../utils/logger";
import { Notice, requestUrl, RequestUrlParam } from "obsidian";

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

    public async streamContent(prompt: string): Promise<any> {
        return this.retryOperation(async () => {
            if (!this.chatModel) throw new Error("Chat model not initialized.");
            const result = await this.chatModel.generateContentStream(prompt);
            return result.stream;
        });
    }

    public async startChat(history: any[], tools?: Tool[]) {
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

            const request: any = {
                content: { role: 'user', parts: [{ text }] },
            };

            if (options.taskType) request.taskType = options.taskType;
            if (options.title) request.title = options.title;

            // Critical: Force 768 dimensions if not specified, to match VectorStore expectation
            request.outputDimensionality = options.outputDimensionality || 768;

            const result = await this.embeddingModel.embedContent(request);
            return result.embedding.values;
        });
    }

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = 10, contentWindow: number = 0): Promise<T> {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                if (error.message?.includes("429") || error.status === 429) {
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
