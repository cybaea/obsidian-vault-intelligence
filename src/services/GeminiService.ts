import { GoogleGenAI, Content, Tool, EmbedContentConfig } from "@google/genai";
import { VaultIntelligenceSettings } from "../settings";
import { logger } from "../utils/logger";

export interface EmbedOptions {
    taskType?: string;
    title?: string;
    outputDimensionality?: number;
}

export class GeminiService {
    private client: GoogleGenAI;
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
            this.client = new GoogleGenAI({ apiKey: this.settings.googleApiKey });
            logger.info("GeminiService initialized with @google/genai.");
        } catch (error) {
            logger.error("Failed to initialize GeminiService:", error);
        }
    }

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.initialize();
    }

    public isReady(): boolean {
        return !!this.client;
    }

    public getEmbeddingModelName(): string {
        return this.settings.embeddingModel;
    }

    public async generateContent(prompt: string): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");
            
            const response = await this.client.models.generateContent({
                model: this.settings.chatModel,
                contents: prompt
            });
            
            return response.text || "";
        });
    }

    // --- Search Sub-Agent ---
    public async searchWithGrounding(query: string): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            // OPTIMIZATION 1: Terse Prompt
            const prompt = `Search for: "${query}". List key facts, dates, and details. Be concise.`;

            // OPTIMIZATION 2: Use Configured Grounding Model (User Setting)
            // Defaults to 'gemini-2.5-flash-lite'
            const groundingModel = this.settings.groundingModel;

            const response = await this.client.models.generateContent({
                model: groundingModel, 
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }]
                }
            });

            return response.text || "No search results could be generated.";
        });
    }

    public async startChat(history: Content[], tools?: Tool[]) {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            const chat = this.client.chats.create({
                model: this.settings.chatModel,
                history: history,
                config: {
                    tools: tools
                }
            });
            return await Promise.resolve(chat);
        });
    }

    public async embedText(text: string, options: EmbedOptions = {}): Promise<number[]> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            const config: EmbedContentConfig = {};
            
            if (options.outputDimensionality) {
                config.outputDimensionality = options.outputDimensionality;
            } else {
                config.outputDimensionality = 768; 
            }

            if (options.taskType) config.taskType = options.taskType;
            if (options.title) config.title = options.title;

            const result = await this.client.models.embedContent({
                model: this.settings.embeddingModel,
                contents: text,
                config: config
            });

            const embeddings = result.embeddings;
            
            if (!embeddings || embeddings.length === 0) {
                throw new Error("No embeddings returned.");
            }

            const firstEmbedding = embeddings[0];
            
            if (!firstEmbedding || !firstEmbedding.values) {
                throw new Error("No embedding values found.");
            }

            return firstEmbedding.values;
        });
    }

    private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.settings.geminiRetries): Promise<T> {
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
