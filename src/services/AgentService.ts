import { GeminiService } from "./GeminiService";
import { VectorStore } from "../services/VectorStore";
import { TFile, App, requestUrl } from "obsidian";
import { Type, Part, Tool, Content, FunctionDeclaration } from "@google/genai";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";

export interface ChatMessage {
    role: "user" | "model" | "system";
    text: string;
    thought?: string;
}

interface VaultSearchResult {
    path: string;
    score: number;
    isKeywordMatch?: boolean;
}

export class AgentService {
    private gemini: GeminiService;
    private vectorStore: VectorStore;
    private app: App;
    private settings: VaultIntelligenceSettings;

    constructor(app: App, gemini: GeminiService, vectorStore: VectorStore, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.gemini = gemini;
        this.vectorStore = vectorStore;
        this.settings = settings;
    }

    private getTools(): Tool[] {
        // 1. Vault Search
        const vaultSearch: FunctionDeclaration = {
            name: "vault_search",
            description: "Search the user's personal Obsidian notes (vault) for information and context.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: "The search query to find relevant notes."
                    }
                },
                required: ["query"]
            }
        };

        // 2. URL Reader
        const urlReader: FunctionDeclaration = {
            name: "read_url",
            description: "Read the content of a specific external URL.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    url: {
                        type: Type.STRING,
                        description: "The full URL to read."
                    }
                },
                required: ["url"]
            }
        };

        // 3. Google Search (Sub-Agent)
        const googleSearch: FunctionDeclaration = {
            name: "google_search",
            description: "Perform a Google search to find the latest real-world information, facts, dates, or news.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: "The search terms."
                    }
                },
                required: ["query"]
            }
        };

        return [{
            functionDeclarations: [vaultSearch, urlReader, googleSearch]
        }];
    }

    private async executeFunction(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        if (name === "google_search") {
            try {
                const query = args.query as string;
                logger.info(`Delegating search to sub-agent for: ${query}`);
                const searchResult = await this.gemini.searchWithGrounding(query);
                return { result: searchResult };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error("Search sub-agent failed", e);
                return { error: `Search failed: ${message}` };
            }
        }

        if (name === "vault_search") {
            const query = args.query as string;
            const taskType = 'RETRIEVAL_QUERY';
            const embedding = await this.gemini.embedText(query, { taskType });
            
            const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
            const limit = Math.max(0, Math.trunc(rawLimit));

            let vectorResults = this.vectorStore.findSimilar(embedding, limit);

            if (vectorResults.length === 0) {
                logger.debug("No results at default threshold, retrying with 0.25...");
                vectorResults = this.vectorStore.findSimilar(embedding, limit, 0.25);
            }

            const keywordResults: VaultSearchResult[] = [];
            if (query.length > 3) {
                const files = this.app.vault.getMarkdownFiles();
                let matchesFound = 0;
                for (const file of files) {
                    if (matchesFound >= 3) break; 
                    if (vectorResults.some(r => r.path === file.path)) continue;

                    try {
                        const content = await this.app.vault.cachedRead(file); 
                        if (content.toLowerCase().includes(query.toLowerCase())) {
                            keywordResults.push({
                                path: file.path,
                                score: 1.0, 
                                isKeywordMatch: true
                            });
                            matchesFound++;
                        }
                    } catch { /* ignore */ }
                }
            }

            const allResults = [...keywordResults, ...vectorResults];

            if (allResults.length === 0) return { result: "No relevant notes found." };

            let context = "";
            let contextLength = 0;
            const MAX_CONTEXT = 12000; 

            for (const doc of allResults as VaultSearchResult[]) {
                const file = this.app.vault.getAbstractFileByPath(doc.path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const header = `\n--- Document: ${doc.path} (Score: ${doc.score.toFixed(2)}${doc.isKeywordMatch ? " [Keyword Match]" : ""}) ---\n`;
                    const docLimit = 2000;
                    const clippedContent = content.substring(0, docLimit);

                    if (contextLength + clippedContent.length > MAX_CONTEXT) break;

                    context += header + clippedContent + "\n";
                    contextLength += clippedContent.length;
                }
            }
            return { result: context };
        }

        if (name === "read_url") {
            try {
                const url = args.url as string;
                const res = await requestUrl({ url });
                return { result: res.text.substring(0, 5000) };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                return { error: `Failed to read URL: ${message}` };
            }
        }

        return { error: "Tool not found." };
    }

    public async chat(history: ChatMessage[], message: string, contextFiles: TFile[] = []): Promise<string> {
        const formattedHistory = history.map(h => ({
            role: h.role as "user" | "model",
            parts: [{ text: h.text }]
        })) as Content[];

        if (contextFiles.length > 0) {
            let fileContext = "The user has explicitly referenced the following notes. Please prioritize this information:\n\n";
            for (const file of contextFiles) {
                try {
                    const content = await this.app.vault.read(file);
                    fileContext += `--- Content of ${file.path} ---\n${content}\n\n`;
                } catch (e) {
                    logger.error(`Failed to read referenced file: ${file.path}`, e);
                }
            }
            message = `${fileContext}User Query: ${message}`;
        }

        const systemPrompt = "[SYSTEM: ALWAYS use 'google_search' to verify external facts, dates, and news. ALWAYS use 'vault_search' for personal notes.]";

        if (formattedHistory.length === 0) {
             message = `${systemPrompt}\n\n${message}`;
        }

        const chat = await this.gemini.startChat(formattedHistory, this.getTools());

        try {
            let result = await chat.sendMessage({ message: message });
            
            let loops = 0;
            const maxLoops = this.settings?.maxAgentSteps ?? DEFAULT_SETTINGS.maxAgentSteps;

            while (loops < maxLoops) {
                const calls = result.functionCalls; 
                
                if (calls && calls.length > 0) {
                    const toolPromises = calls.map(async (call) => {
                        if (!call.name) return null;
                        
                        const args = call.args || {};
                        const functionResponse = await this.executeFunction(call.name, args);
                        
                        return {
                            functionResponse: {
                                name: call.name,
                                response: functionResponse
                            }
                        } as Part;
                    });

                    const completedParts = (await Promise.all(toolPromises)).filter((p): p is Part => p !== null);

                    if (completedParts.length > 0) {
                        result = await chat.sendMessage({ message: completedParts });
                    } else {
                        break; 
                    }
                } else {
                    break;
                }
                loops++;
            }

            // FIX: Check for pending function calls before accessing text.
            // If functionCalls exist here, we hit the max step limit.
            // Accessing .text on a functionCall response triggers a console warning in the SDK.
            if (result.functionCalls && result.functionCalls.length > 0) {
                logger.warn("Agent hit max steps limit with pending tool calls.");
                return "I'm sorry, I searched through your notes but couldn't find a definitive answer within the step limit. You might try rephrasing your query or increasing the 'Max agent steps' setting.";
            }

            return result.text || "";

        } catch (e: unknown) {
            logger.error("Error in chat loop", e);
            return "Sorry, I encountered an error processing your request.";
        }
    }
}