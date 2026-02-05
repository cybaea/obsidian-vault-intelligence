import { GoogleGenAI, Content, Tool, EmbedContentConfig } from "@google/genai";

import { MODEL_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings";
import { logger } from "../utils/logger";

export interface EmbedOptions {
    outputDimensionality?: number;
    taskType?: string;
    title?: string;
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
            logger.info("GeminiService initialized for Chat/Reasoning with @google/genai.");
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
                contents: prompt,
                model: this.settings.chatModel
            });

            return response.text || "";
        });
    }

    /**
     * Generates content with a structured JSON output based on a provided schema.
     * @param prompt - The prompt text.
     * @param schema - The JSON schema for the response.
     * @returns The JSON string response.
     */
    public async generateStructuredContent(
        prompt: string,
        schema: Record<string, unknown>,
        options: { model?: string; systemInstruction?: string; tools?: Tool[] } = {}
    ): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            const modelId = options.model || this.settings.chatModel;

            const response = await this.client.models.generateContent({
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                    systemInstruction: options.systemInstruction,
                    tools: options.tools
                },
                contents: prompt,
                model: modelId
            });

            return response.text || "";
        });
    }

    // --- Search Sub-Agent ---
    /**
     * Performs a web search using Google Search Grounding.
     * @param query - The search query.
     * @returns A synthesis of search results including facts and dates.
     */
    public async searchWithGrounding(query: string): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            const prompt = `Search for: "${query}". List key facts, dates, and details. Be concise.`;
            const groundingModel = this.settings.groundingModel;

            const response = await this.client.models.generateContent({
                config: {
                    tools: [{ googleSearch: {} }]
                },
                contents: prompt,
                model: groundingModel
            });

            return response.text || "No search results could be generated.";
        });
    }

    // --- Code Execution Sub-Agent ---

    /**
     * Solves a problem using the Code Execution tool (Python).
     * @param query - The problem statement or logic task.
     * @returns The text response, including code blocks and execution results.
     */
    public async solveWithCode(query: string): Promise<string> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            if (!this.settings.enableCodeExecution || !this.settings.codeModel) {
                return "Code execution is currently disabled in settings.";
            }

            const codeModel = this.settings.codeModel;

            const response = await this.client.models.generateContent({
                config: {
                    tools: [{ codeExecution: {} }]
                },
                contents: query,
                model: codeModel
            });

            // FIX: Manually parse parts to avoid SDK warning about non-text parts.
            // This also ensures the Main Agent sees the code and the result.
            const parts = response.candidates?.[0]?.content?.parts;
            if (!parts) return "No result generated.";

            let resultString = "";

            for (const part of parts) {
                // 1. Standard Text (Reasoning or Answer)
                if (part.text) {
                    resultString += part.text + "\n";
                }

                // 2. The Python Code Generated
                if (part.executableCode) {
                    resultString += `\n[Generated Code]\n\`\`\`python\n${part.executableCode.code}\n\`\`\`\n`;
                }

                // 3. The Output of the Code
                if (part.codeExecutionResult) {
                    resultString += `\n[Execution Result]\n${part.codeExecutionResult.output}\n`;
                }
            }

            return resultString.trim() || "No result generated from code execution.";
        });
    }

    /**
     * Starts a standard chat session with history and tools.
     * @param history - The conversation history.
     * @param tools - Optional list of tools to enable for this session.
     * @param systemInstruction - System prompt.
     * @param modelId - Optional model ID override.
     * @returns A GenAI ChatSession object.
     */
    public async startChat(history: Content[], tools?: Tool[], systemInstruction: string = "", modelId?: string) {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            const chat = this.client.chats.create({
                config: {
                    systemInstruction: systemInstruction,
                    tools: tools
                },
                history: history,
                model: modelId || this.settings.chatModel
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
                config.outputDimensionality = this.settings.embeddingDimension;
            }

            if (options.taskType) config.taskType = options.taskType;
            if (options.title) config.title = options.title;

            let modelId = this.settings.embeddingModel;
            // Migration/Fix: If the user has 'embedding-001' or similar without prefix
            if (modelId === 'embedding-001') modelId = MODEL_CONSTANTS.EMBEDDING_001;
            if (modelId === 'embedding-004') modelId = MODEL_CONSTANTS.TEXT_EMBEDDING_004;

            const result = await this.client.models.embedContent({
                config: config,
                contents: text,
                model: modelId
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
                const isTransientError = error instanceof Error && (
                    error.message.includes("429") ||
                    (error as { status?: number }).status === 429 ||
                    error.message.includes("Failed to fetch")
                );

                if (isTransientError) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    logger.warn(`Transient error (${error instanceof Error ? error.message : "unknown"}). Retrying in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
        throw new Error("Max retries reached.");
    }

    // --- Dual-Loop Analyst ---
    /**
     * Re-ranks search candidates using the Analyst model (Loop 2).
     */
    public async reRank(query: string, payload: unknown[]): Promise<unknown[]> {
        return this.retryOperation(async () => {
            if (!this.client) throw new Error("GenAI client not initialized.");

            // Truncate payload if too huge (should be handled by packer budget, but safety first)
            const safePayload = payload.slice(0, 50);

            const prompt = `
            You are the Analyst, an AI ranking engine for a personal knowledge graph.
            Your goal is to re-rank the provided search candidates based on their semantic relevance to the user's query.
            
            Query: "${query}"
            
            Candidates (JSON):
            ${JSON.stringify(safePayload)}
            
            Instructions:
            1. Analyze the content of each candidate.
            2. Ignore text properties (YAML) unless relevant to the query.
            3. Prioritize "Concept" notes and strong semantic matches over loose keyword matches.
            4. Be generous with synonyms (e.g., if query is "cat", find stories about individual cats like "Bartholomew").
            5. Return a JSON array of the top relevant items, sorted by relevance.
            
            Schema:
            Array<{ id: string, score: number, reasoning: string }>
            `;

            const schema = {
                description: "List of ranked items",
                items: {
                    properties: {
                        id: { type: "STRING" },
                        reasoning: { type: "STRING" },
                        score: { type: "NUMBER" }
                    },
                    required: ["id", "score"],
                    type: "OBJECT"
                },
                type: "ARRAY"
            };

            // CASTING: The SDK types might be strict. We pass it as unknown if needed.
            const response = await this.generateStructuredContent(prompt, schema as unknown as Record<string, unknown>, {
                model: this.settings.reRankingModel || this.settings.chatModel
            });

            try {
                const parsed = JSON.parse(response) as unknown;
                // Validation: ensure it's an array
                if (Array.isArray(parsed)) return parsed as unknown[];
                return [];
            } catch (e) {
                logger.error("Failed to parse Analyst response", e);
                return [];
            }
        });
    }
}