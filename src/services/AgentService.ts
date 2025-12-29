import { GeminiService } from "./GeminiService";
import { VectorStore } from "../services/VectorStore";
import { TFile, App, requestUrl } from "obsidian";
import { FunctionDeclaration, SchemaType, TaskType } from "@google/generative-ai";
import { logger } from "../utils/logger";

export class AgentService {
    private gemini: GeminiService;
    private vectorStore: VectorStore;
    private app: App;

    constructor(app: App, gemini: GeminiService, vectorStore: VectorStore) {
        this.app = app;
        this.gemini = gemini;
        this.vectorStore = vectorStore;
    }

    private getTools() {
        // Vault Search Tool Definition
        const vaultSearch: FunctionDeclaration = {
            name: "vault_search",
            description: "Search the user's personal Obsidian notes (vault) for information and context.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    query: {
                        type: SchemaType.STRING,
                        description: "The search query to find relevant notes."
                    }
                },
                required: ["query"]
            }
        };

        // URL Reader Tool Definition
        const urlReader: FunctionDeclaration = {
            name: "read_url",
            description: "Read the content of a specific external URL.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    url: {
                        type: SchemaType.STRING,
                        description: "The full URL to read."
                    }
                },
                required: ["url"]
            }
        };

        // Google Search Grounding is enabled via a separate configuration in Gemini, 
        // but for now let's assume we use the Google Search tool if available or define it.
        // If we use the 'google_search_retrieval' tool from the SDK it's different.
        // For simplicity, we stick to custom tools first.

        return [{
            functionDeclarations: [vaultSearch, urlReader]
        }];
    }

    private async executeFunction(name: string, args: any): Promise<any> {
        logger.info(`Executing tool ${name} with args:`, args);

        if (name === "vault_search") {
            const query = args.query;
            const embedding = await this.gemini.embedText(query, { taskType: TaskType.RETRIEVAL_QUERY });
            const results = this.vectorStore.findSimilar(embedding, 5);

            if (results.length === 0) return { result: "No relevant notes found." };

            let context = "";
            for (const doc of results) {
                const file = this.app.vault.getAbstractFileByPath(doc.path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    // Truncate to avoid context limit issues
                    context += `\n--- Document: ${doc.path} ---\n${content.substring(0, 1500)}\n`;
                }
            }
            return { result: context };
        }

        if (name === "read_url") {
            try {
                const res = await requestUrl({ url: args.url });
                return { result: res.text.substring(0, 5000) }; // Truncate
            } catch (e: any) {
                return { error: `Failed to read URL: ${e.message}` };
            }
        }

        return { error: "Tool not found." };
    }

    public async chat(history: any[], message: string): Promise<string> {
        // Prepare history for Gemini SDK
        const formattedHistory = history.map(h => ({
            role: h.role,
            parts: [{ text: h.text }] // Simplified
        }));

        // Start chat
        const chat = await this.gemini.startChat(formattedHistory, this.getTools());

        try {
            let result = await chat.sendMessage(message);
            let response = await result.response;

            // Loop for function calls
            // LIMIT LOOPS to avoid infinite recursion
            let loops = 0;
            while (loops < 5) {
                const calls = response.functionCalls();
                if (calls && calls.length > 0) {
                    // Execute calls
                    const parts: any[] = [];
                    for (const call of calls) {
                        const functionResponse = await this.executeFunction(call.name, call.args);
                        parts.push({
                            functionResponse: {
                                name: call.name,
                                response: functionResponse
                            }
                        });
                    }
                    // Send back results
                    result = await chat.sendMessage(parts);
                    response = await result.response;
                } else {
                    break;
                }
                loops++;
            }

            return response.text();

        } catch (e: any) {
            logger.error("Error in chat loop", e);
            return "Sorry, I encountered an error processing your request.";
        }
    }
}
