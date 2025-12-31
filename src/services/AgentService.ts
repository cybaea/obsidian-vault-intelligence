import { GeminiService } from "./GeminiService";
import { VectorStore } from "../services/VectorStore";
import { TFile, App, requestUrl } from "obsidian";
import { FunctionDeclaration, SchemaType, TaskType } from "@google/generative-ai";
import { logger } from "../utils/logger";
import { Part } from "@google/generative-ai";

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

    private async executeFunction(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        if (name === "vault_search") {
            const query = args.query as string;

            // 1. Determine Task Type
            // const isQuestion = query.includes("?") || /^(who|what|where|when|why|how)/i.test(query);
            // const taskType = isQuestion ? TaskType.QUESTION_ANSWERING : TaskType.RETRIEVAL_QUERY;
            // SDK might not support QUESTION_ANSWERING yet, fallback to RETRIEVAL_QUERY
            const taskType = TaskType.RETRIEVAL_QUERY;

            const embedding = await this.gemini.embedText(query, { taskType });

            // 2. Vector Search (Semantic)
            let vectorResults = this.vectorStore.findSimilar(embedding, 5);

            // Fallback for vector search
            if (vectorResults.length === 0) {
                logger.debug("No results at default threshold, retrying with 0.25...");
                vectorResults = this.vectorStore.findSimilar(embedding, 5, 0.25);
            }

            // 3. Keyword Search (Exact Match)
            // This is a simple fallback for specific entity names or phrases that vector search might miss in large docs
            const keywordResults: VaultSearchResult[] = [];
            // optimization: only search if query is specific enough (e.g. > 3 chars)
            if (query.length > 3) {
                const files = this.app.vault.getMarkdownFiles();
                // Limit to scanning ? Maybe 100 recent files? Or all if small? 
                // Let's just scan all but break early if we find matches? No, we need top matches.
                // Simple implementation: Scan all. WARNING: Slow on huge vaults.

                let matchesFound = 0;
                for (const file of files) {
                    if (matchesFound >= 3) break; // Limit keyword matches to top 3

                    // Skip if already in vector results
                    if (vectorResults.some(r => r.path === file.path)) continue;

                    try {
                        const content = await this.app.vault.cachedRead(file); // Cached read is faster
                        if (content.toLowerCase().includes(query.toLowerCase())) {
                            keywordResults.push({
                                path: file.path,
                                score: 1.0, // High confidence for exact match
                                isKeywordMatch: true
                            });
                            matchesFound++;
                        }
                    } catch {
                        // ignore read errors
                    }
                }
            }

            // 4. Merge Results
            const allResults = [...keywordResults, ...vectorResults];

            if (allResults.length === 0) return { result: "No relevant notes found." };

            let context = "";
            let contextLength = 0;
            const MAX_CONTEXT = 12000; // ~3k tokens

            for (const doc of allResults as VaultSearchResult[]) {
                const file = this.app.vault.getAbstractFileByPath(doc.path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);

                    // Simple snippet extraction for keyword matches could be better, but full doc is fine for RAG
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
        // Prepare history for Gemini SDK
        const formattedHistory = history.map(h => ({
            role: h.role as "user" | "model",
            parts: [{ text: h.text }] as Part[]
        }));

        // Inject specific file context if provided
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

            // Prepend context to the current message
            message = `${fileContext}User Query: ${message}`;
        }

        // Start chat
        const chat = await this.gemini.startChat(formattedHistory, this.getTools());

        try {
            let result = await chat.sendMessage(message);
            let response = result.response;

            // Loop for function calls
            // LIMIT LOOPS to avoid infinite recursion
            let loops = 0;
            while (loops < 5) {
                const calls = response.functionCalls();
                if (calls && calls.length > 0) {
                    // Execute calls
                    const parts: Part[] = [];
                    for (const call of calls) {
                        const functionResponse = await this.executeFunction(call.name, call.args as Record<string, unknown>);
                        parts.push({
                            functionResponse: {
                                name: call.name,
                                response: functionResponse
                            }
                        });
                    }
                    // Send back results
                    result = await chat.sendMessage(parts);
                    response = result.response;
                } else {
                    break;
                }
                loops++;
            }

            return response.text();

        } catch (e: unknown) {
            logger.error("Error in chat loop", e);
            return "Sorry, I encountered an error processing your request.";
        }
    }
}
