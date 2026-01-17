import { IEmbeddingService } from "./IEmbeddingService";
import { GraphService } from "../services/GraphService";
import { GeminiService } from "./GeminiService";
import { TFile, App, requestUrl, MarkdownView } from "obsidian";
import { Type, Part, Tool, Content, FunctionDeclaration } from "@google/genai";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";
import { SEARCH_CONSTANTS } from "../constants";
import { ScoringStrategy } from "./ScoringStrategy";

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
    private graphService: GraphService;
    private embeddingService: IEmbeddingService;
    private app: App;
    private settings: VaultIntelligenceSettings;

    private scoringStrategy: ScoringStrategy;

    constructor(
        app: App,
        gemini: GeminiService,
        graphService: GraphService,
        embeddingService: IEmbeddingService, // Injected here
        settings: VaultIntelligenceSettings
    ) {
        this.app = app;
        this.gemini = gemini; // Still needed for chat/grounding/code
        this.graphService = graphService;
        this.embeddingService = embeddingService;
        this.settings = settings;
        this.scoringStrategy = new ScoringStrategy();
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
                properties: { query: { type: Type.STRING } },
                required: ["query"]
            }
        };

        const toolsList: FunctionDeclaration[] = [vaultSearch, urlReader, googleSearch];

        // 4. Computational Solver (Conditional)
        if (this.settings.enableCodeExecution && this.settings.codeModel.trim().length > 0) {
            const computationalSolver: FunctionDeclaration = {
                name: "computational_solver",
                description: "Use this tool to solve math problems, perform complex logic, or analyze data using code execution.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        task: {
                            type: Type.STRING,
                            description: "The math problem or logic task to solve (e.g., 'Calculate the 50th Fibonacci number')."
                        }
                    },
                    required: ["task"]
                }
            };
            toolsList.push(computationalSolver);
        }

        return [{
            functionDeclarations: toolsList
        }];
    }

    /**
     * Dynamically assembles context from search results based on the current token budget.
     */
    private async assembleContext(results: VaultSearchResult[], query: string): Promise<string> {
        // 1. Calculate Budget based on Settings
        const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
        const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

        // 2. Define "Starvation Protection" limit
        // No single document should take up more than 25% of the budget if there are other results.
        const singleDocSoftLimit = Math.floor(totalCharBudget * SEARCH_CONSTANTS.SINGLE_DOC_SOFT_LIMIT_RATIO);

        logger.debug(`[Context] Budget: ${totalCharBudget} chars. Soft Cap: ${singleDocSoftLimit} chars.`);

        let constructedContext = "";
        let currentUsage = 0;
        let includedCount = 0;

        for (const doc of results) {
            // Check if we are already full
            if (currentUsage >= totalCharBudget) {
                logger.info(`[Context] Budget exhausted after ${includedCount} documents.`);
                break;
            }

            const file = this.app.vault.getAbstractFileByPath(doc.path);
            if (!(file instanceof TFile)) continue;

            try {
                const content = await this.app.vault.read(file);
                let contentToAdd = "";

                // DECISION: Full Content vs. Smart Window
                // We use full content IF:
                // 1. It fits in the remaining budget AND
                // 2. It is smaller than the 'Soft Limit' (to prevent starvation of other docs)
                const fitsInBudget = (currentUsage + content.length) < totalCharBudget;
                const isNotTooHuge = content.length < singleDocSoftLimit;

                if (fitsInBudget && isNotTooHuge) {
                    contentToAdd = content;
                    logger.debug(`[Context] Added full file: ${file.path} (${content.length} chars)`);
                } else {
                    // Fallback: Use Smart Windowing (clipping)
                    // We take a slice of the document centered on the keyword
                    logger.debug(`[Context] Clipping file ${file.path} (Size: ${content.length}).`);

                    // Calculate how much space we can reasonably give this doc
                    // (Either the remaining budget OR the soft limit, whichever is smaller)
                    const availableSpace = Math.min(singleDocSoftLimit, totalCharBudget - currentUsage);

                    if (availableSpace < SEARCH_CONSTANTS.MIN_DOC_CONTEXT_CHARS) continue; // Skip if too little space left

                    if (doc.isKeywordMatch) {
                        // Center window on match
                        const idx = content.toLowerCase().indexOf(query.toLowerCase());
                        if (idx !== -1) {
                            const halfWindow = Math.floor(availableSpace / 2);
                            const start = Math.max(0, idx - halfWindow);
                            const end = Math.min(content.length, idx + halfWindow);
                            contentToAdd = `...[clipped]...\n${content.substring(start, end)}\n...[clipped]...`;
                        } else {
                            contentToAdd = content.substring(0, availableSpace) + "\n...[clipped]...";
                        }
                    } else {
                        // Vector match without keyword? Just take the start.
                        contentToAdd = content.substring(0, availableSpace) + "\n...[clipped]...";
                    }
                    logger.debug(`[Context] Added clipped file: ${file.path} (${contentToAdd.length} chars)`);
                }

                const header = `\n--- Document: ${doc.path} (Score: ${doc.score.toFixed(2)}) ---\n`;
                constructedContext += header + contentToAdd + "\n";
                currentUsage += contentToAdd.length;
                includedCount++;

            } catch (e) {
                logger.error(`Failed to read file for context: ${doc.path}`, e);
            }
        }

        return constructedContext;
    }

    private async executeFunction(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        if (name === "google_search") {
            try {
                // Safety check for query
                const rawQuery = args.query;
                const query = typeof rawQuery === 'string' ? rawQuery : JSON.stringify(rawQuery);

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
            // Safety: Ensure query is a string
            const rawQuery = args.query;
            const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

            if (!query || query.trim().length === 0) {
                logger.warn("Vault search called with empty query.");
                return { result: "Error: Search query was empty." };
            }

            logger.info(`[VaultSearch] Starting search for: "${query}"`);

            // 1. Vector Search (Semantic)
            const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
            const limit = Math.max(0, Math.trunc(rawLimit));

            let vectorResults = await this.graphService.search(query, limit);
            logger.info(`[VaultSearch] Vector search returned ${vectorResults.length} candidates.`);

            // 2. Keyword Search (Hybrid: Exact + Bag-of-Words)
            const keywordResults: VaultSearchResult[] = [];

            if (query.length > 2) {
                const files = this.app.vault.getMarkdownFiles();

                // FIX: Token Cleaning
                // 1. Remove quotes
                // 2. Remove boolean operators (OR, AND) which the Agent likes to use
                // 3. Filter short words
                const cleanQuery = query.replace(/["'()]/g, " ");
                const tokens = cleanQuery.split(/\s+/)
                    .map(t => t.trim())
                    .filter(t => t.length > 2 && t !== "or" && t !== "and");

                const isMultiWord = tokens.length > 1;

                let keywordMatchesFound = 0;
                const MAX_KEYWORD_MATCHES = 100;

                for (const file of files) {
                    if (keywordMatchesFound >= MAX_KEYWORD_MATCHES) break;

                    const titleLower = file.basename.toLowerCase();

                    // A. Title Exact Match
                    const titleScore = this.scoringStrategy.calculateTitleScore(titleLower, query);
                    if (titleScore !== null) {
                        keywordResults.push({ path: file.path, score: titleScore, isKeywordMatch: true, isTitleMatch: true });
                        keywordMatchesFound++;
                        continue;
                    }

                    // B. Body Scan
                    try {
                        const content = await this.app.vault.cachedRead(file);
                        const contentLower = content.toLowerCase();

                        // B1. Exact Phrase Match (Highest Body Score)
                        const bodyExactScore = this.scoringStrategy.calculateExactBodyScore(contentLower, query);
                        if (bodyExactScore !== null) {
                            keywordResults.push({ path: file.path, score: bodyExactScore, isKeywordMatch: true, isTitleMatch: false });
                            keywordMatchesFound++;
                            continue;
                        }

                        // B2. "Bag of Words" Match (Flexible)
                        if (isMultiWord) {
                            const fuzzyScore = this.scoringStrategy.calculateFuzzyScore(tokens, contentLower);

                            if (fuzzyScore > 0) {
                                keywordResults.push({ path: file.path, score: fuzzyScore, isKeywordMatch: true, isTitleMatch: false });
                                keywordMatchesFound++;
                            }
                        }
                    } catch { /* ignore read errors */ }
                }
                logger.info(`[VaultSearch] Keyword search found ${keywordResults.length} matches for "${query}" (Exact + Fuzzy).`);
            }

            // 3. Hybrid Merge & Rank
            const mergedMap = new Map<string, VaultSearchResult>();

            // Add Vector Results
            for (const res of vectorResults) {
                mergedMap.set(res.path, res);
            }

            // Add/Merge Keyword Results
            for (const res of keywordResults) {
                const existing = mergedMap.get(res.path);

                if (existing !== undefined) {
                    logger.debug(`[VaultSearch] Boosting score for: ${res.path} (Vector + Keyword)`);
                    existing.score = this.scoringStrategy.boostHybridResult(existing.score, {
                        score: res.score,
                        isKeywordMatch: !!res.isKeywordMatch,
                        isTitleMatch: !!res.isTitleMatch
                    });
                    existing.isKeywordMatch = true;
                } else {
                    mergedMap.set(res.path, res);
                }
            }

            const finalResults = Array.from(mergedMap.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            logger.info(`[VaultSearch] Final ranked results: ${finalResults.length} docs.`);

            const topMatch = finalResults[0];
            if (topMatch) {
                logger.info(`[VaultSearch] Top match: ${topMatch.path} (Score: ${topMatch.score.toFixed(2)})`);
            }

            if (finalResults.length === 0) return { result: "No relevant notes found." };

            // 4. Build Context
            const context = await this.assembleContext(finalResults, query);

            if (!context) return { result: "No relevant notes found or context budget exceeded." };
            return { result: context };
        }

        if (name === "read_url") {
            try {
                const url = args.url as string;
                const res = await requestUrl({ url });
                return { result: res.text.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                return { error: `Failed to read URL: ${message}` };
            }
        }

        if (name === "computational_solver") {
            try {
                // Double check settings at runtime
                if (!this.settings.enableCodeExecution) {
                    return { error: "Code execution tool is disabled in settings." };
                }

                const task = args.task as string;
                logger.info(`Delegating to Code Sub-Agent (${this.settings.codeModel}): ${task}`);

                // Call GeminiService
                const result = await this.gemini.solveWithCode(task);
                return { result: result };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error("Code sub-agent failed", e);
                return { error: `Calculation failed: ${message}` };
            }
        }

        return { error: "Tool not found." };
    }

    public async chat(history: ChatMessage[], message: string, contextFiles: TFile[] = []): Promise<string> {
        // Auto-inject active file if none provided
        if (contextFiles.length === 0) {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file) {
                logger.info(`[Agent] Auto-injecting active file into context: ${activeView.file.path}`);
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

        const currentDate = new Date().toDateString();
        const rawSystemInstruction = this.settings.systemInstruction || DEFAULT_SETTINGS.systemInstruction;

        // Replace {{DATE}} placeholder
        const systemInstruction = rawSystemInstruction.replace("{{DATE}}", currentDate);

        // Pass dynamic systemInstruction to the service
        const chat = await this.gemini.startChat(formattedHistory, this.getTools(), systemInstruction);

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