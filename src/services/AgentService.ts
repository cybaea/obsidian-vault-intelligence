import { GeminiService } from "./GeminiService";
import { VectorStore } from "../services/VectorStore";
import { TFile, App, requestUrl, MarkdownView } from "obsidian";
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
    isTitleMatch?: boolean;
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
            const query = (args.query as string).toLowerCase();
            const taskType = 'RETRIEVAL_QUERY';
            
            // 1. Vector Search (Semantic)
            // Use lower threshold (0.35) to capture more candidates for ranking
            const embedding = await this.gemini.embedText(query, { taskType });
            const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
            const limit = Math.max(0, Math.trunc(rawLimit));
            
            let vectorResults = this.vectorStore.findSimilar(embedding, limit, 0.35);

            // 2. Keyword Search (Exact Match)
            const keywordResults: VaultSearchResult[] = [];
            
            if (query.length > 2) { 
                const files = this.app.vault.getMarkdownFiles();
                
                let keywordMatchesFound = 0;
                // FIX: Limit increased to 100. 
                // This means we scan the WHOLE vault until we find 100 *positive matches*.
                // If "Knight Capital" is only in 1 file, we will find it.
                const MAX_KEYWORD_MATCHES = 100; 

                for (const file of files) {
                    if (keywordMatchesFound >= MAX_KEYWORD_MATCHES) break;

                    // A. Title Match
                    if (file.basename.toLowerCase().includes(query)) {
                        keywordResults.push({
                            path: file.path,
                            score: 1.0, 
                            isKeywordMatch: true,
                            isTitleMatch: true
                        });
                        keywordMatchesFound++;
                        continue; 
                    }

                    // B. Body Match (The Critical Fix)
                    const inVector = vectorResults.some(r => r.path === file.path);
                    if (!inVector) {
                        try {
                            const content = await this.app.vault.cachedRead(file);
                            // This finds "Knight Capital" anywhere in the body text
                            if (content.toLowerCase().includes(query)) {
                                keywordResults.push({
                                    path: file.path,
                                    score: 0.5, 
                                    isKeywordMatch: true,
                                    isTitleMatch: false
                                });
                                keywordMatchesFound++;
                            }
                        } catch { /* ignore read errors */ }
                    }
                }
            }

            // 3. Hybrid Merge & Rank
            const mergedMap = new Map<string, VaultSearchResult>();

            // Add Vector Results
            for (const res of vectorResults) {
                mergedMap.set(res.path, res);
            }

            // Add/Merge Keyword Results
            for (const res of keywordResults) {
                if (mergedMap.has(res.path)) {
                    const existing = mergedMap.get(res.path)!;
                    existing.score += 0.3; // Boost score if matched both ways
                    existing.isKeywordMatch = true;
                    if (res.isTitleMatch) existing.score += 0.5; 
                } else {
                    mergedMap.set(res.path, res);
                }
            }

            const finalResults = Array.from(mergedMap.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, limit); 

            if (finalResults.length === 0) return { result: "No relevant notes found." };

            // 4. Build Context
            let context = "";
            let contextLength = 0;
            // FIX: Large context window for Gemini Flash
            const MAX_TOTAL_CONTEXT = 200000; 
            const DOC_CHAR_LIMIT = 50000;     

            for (const doc of finalResults) {
                const file = this.app.vault.getAbstractFileByPath(doc.path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    
                    let clippedContent = "";
                    if (content.length <= DOC_CHAR_LIMIT) {
                        clippedContent = content;
                    } else {
                        // FIX: Smart Windowing
                        // If we found the file via keyword match, center the view on that keyword.
                        if (doc.isKeywordMatch) {
                            const idx = content.toLowerCase().indexOf(query);
                            if (idx !== -1) {
                                // Extract 10k chars before and 40k chars after the match
                                const start = Math.max(0, idx - 10000); 
                                const end = Math.min(content.length, idx + 40000);
                                clippedContent = `...[clipped]...\n${content.substring(start, end)}\n...[clipped]...`;
                            } else {
                                clippedContent = content.substring(0, DOC_CHAR_LIMIT);
                            }
                        } else {
                             clippedContent = content.substring(0, DOC_CHAR_LIMIT);
                        }
                    }

                    const header = `\n--- Document: ${doc.path} (Score: ${doc.score.toFixed(2)}${doc.isKeywordMatch ? " [Match]" : ""}) ---\n`;
                    
                    if (contextLength + clippedContent.length > MAX_TOTAL_CONTEXT) break;

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
        // Auto-inject active file if none provided
        if (contextFiles.length === 0) {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file) {
                logger.debug(`Auto-injecting active file into context: ${activeView.file.path}`);
                contextFiles.push(activeView.file);
            }
        }

        const formattedHistory = history.map(h => ({
            role: h.role as "user" | "model",
            parts: [{ text: h.text }]
        })) as Content[];

        if (contextFiles.length > 0) {
            let fileContext = "The user has explicitly referenced the following notes (or has them open). Please prioritize this information:\n\n";
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