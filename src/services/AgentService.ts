import { Type, Part, Tool, Content, FunctionDeclaration } from "@google/genai";
import { TFile, App, requestUrl, MarkdownView } from "obsidian";

import { SEARCH_CONSTANTS, AGENT_CONSTANTS } from "../constants";
import { GraphService } from "../services/GraphService";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { ContextAssembler } from "./ContextAssembler";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService } from "./IEmbeddingService";
import { SearchOrchestrator } from "./SearchOrchestrator";

export interface ChatMessage {
    contextFiles?: string[];
    role: "user" | "model" | "system";
    text: string;
    thought?: string;
}

/**
 * Service responsible for orchestrating the AI agent activities.
 * It manages tool execution, chat history, and context assembly.
 */
export class AgentService {
    private gemini: GeminiService;
    private graphService: GraphService;
    private embeddingService: IEmbeddingService;
    private app: App;
    private settings: VaultIntelligenceSettings;

    private searchOrchestrator: SearchOrchestrator;
    private contextAssembler: ContextAssembler;

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

        // Initialize delegates
        this.searchOrchestrator = new SearchOrchestrator(app, graphService, settings);
        this.contextAssembler = new ContextAssembler(app, graphService, settings);
    }

    /**
     * Constructs the list of tools available to the agent.
     * Includes vault search, URL reading, Google search, and optionally code execution.
     * @param enableCodeExecution - Optional override for code execution enablement.
     * @returns Array of Tool definitions compatible with Google GenAI.
     */
    private getTools(enableCodeExecution?: boolean): Tool[] {
        // Use override if provided, otherwise fallback to settings
        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;

        // 1. Vault Search
        const vaultSearch: FunctionDeclaration = {
            description: "Search the user's personal Obsidian notes (vault) for information and context.",
            name: AGENT_CONSTANTS.TOOLS.VAULT_SEARCH,
            parameters: {
                properties: {
                    query: {
                        description: "The search query to find relevant notes.",
                        type: Type.STRING
                    }
                },
                required: ["query"],
                type: Type.OBJECT
            }
        };

        // 2. URL Reader
        const urlReader: FunctionDeclaration = {
            description: "Read the content of a specific external URL.",
            name: AGENT_CONSTANTS.TOOLS.URL_READER,
            parameters: {
                properties: {
                    url: {
                        description: "The full URL to read.",
                        type: Type.STRING
                    }
                },
                required: ["url"],
                type: Type.OBJECT
            }
        };

        // 3. Google Search (Sub-Agent)
        const googleSearch: FunctionDeclaration = {
            description: "Perform a Google search to find the latest real-world information, facts, dates, or news.",
            name: AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH,
            parameters: {
                properties: { query: { type: Type.STRING } },
                required: ["query"],
                type: Type.OBJECT
            }
        };

        // 4. Graph Explorer
        const graphExplorer: FunctionDeclaration = {
            description: "Find notes linked to or from a specific note. Use this to discover context not immediately visible in search results.",
            name: AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES,
            parameters: {
                properties: {
                    path: {
                        description: "The path of the note to find connections for.",
                        type: Type.STRING
                    }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        };

        const toolsList: FunctionDeclaration[] = [vaultSearch, urlReader, googleSearch, graphExplorer];

        // 5. Computational Solver (Conditional)
        if (isCodeEnabled && this.settings.codeModel.trim().length > 0) {
            const computationalSolver: FunctionDeclaration = {
                description: "Use this tool to solve math problems, perform complex logic, or analyze data using code execution.",
                name: AGENT_CONSTANTS.TOOLS.CALCULATOR,
                parameters: {
                    properties: {
                        task: {
                            description: "The math problem or logic task to solve (e.g., 'Calculate the 50th Fibonacci number').",
                            type: Type.STRING
                        }
                    },
                    required: ["task"],
                    type: Type.OBJECT
                }
            };
            toolsList.push(computationalSolver);
        }

        return [{
            functionDeclarations: toolsList
        }];
    }

    /**
     * Executes a specific tool called by the AI model.
     * @param name - The name/ID of the tool (function) to execute.
     * @param args - The arguments provided by the AI model for the tool.
     * @param usedFiles - A set to track files that were read during tool execution for context.
     * @param enableCodeExecution - Optional override for code execution enablement.
     * @returns A result object (JSON) to be returned to the model.
     * @private
     */
    private async executeFunction(name: string, args: Record<string, unknown>, usedFiles: Set<string>, enableCodeExecution?: boolean): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;
        let result: Record<string, unknown>;

        if (name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH) {
            try {
                // Safety check for query
                const rawQuery = args.query;
                const query = typeof rawQuery === 'string' ? rawQuery : JSON.stringify(rawQuery);

                logger.info(`Delegating search to sub-agent for: ${query}`);
                const searchResult = await this.gemini.searchWithGrounding(query);
                result = { result: searchResult };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error("Search sub-agent failed", e);
                result = { error: `Search failed: ${message}` };
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.VAULT_SEARCH) {
            // Safety: Ensure query is a string
            const rawQuery = args.query;
            const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

            if (!query || query.trim().length === 0) {
                logger.warn("Vault search called with empty query.");
                result = { result: "Error: Search query was empty." };
            } else {
                // 1. Search (Delegated to Orchestrator)
                const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
                const limit = Math.max(0, Math.trunc(rawLimit));

                const results = await this.searchOrchestrator.search(query, limit);

                if (results.length === 0) {
                    result = { result: "No relevant notes found." };
                } else {
                    // 2. Assemble Context (Delegated to Assembler)
                    const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
                    const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

                    const { context, usedFiles: resultFiles } = await this.contextAssembler.assemble(results, query, totalCharBudget);

                    if (!context) {
                        result = { result: "No relevant notes found or context budget exceeded." };
                    } else {
                        // Track files used
                        resultFiles.forEach(f => usedFiles.add(f));
                        result = { result: context };
                    }
                }
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES) {
            const path = (args.path as string) || '';
            if (!path) {
                result = { error: "Path argument is required." };
            } else {
                const neighbors = await this.graphService.getNeighbors(path);
                if (neighbors.length === 0) {
                    result = { result: `No connected notes found for: ${path}` };
                } else {
                    const list = neighbors.map(n => `- ${n.path} (Title: ${n.title})`).join('\n');
                    result = { result: `The following notes are directly connected to ${path}:\n${list}\n\nYou can use vault_search or read their content to explore further.` };
                }
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.URL_READER) {
            try {
                const url = args.url as string;
                const res = await requestUrl({ url });
                result = { result: res.text.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                result = { error: `Failed to read URL: ${message}` };
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.CALCULATOR) {
            try {
                // Double check settings at runtime
                if (!isCodeEnabled) {
                    result = { error: "Code execution tool is disabled." };
                } else {
                    const task = args.task as string;
                    logger.info(`Delegating to Code Sub-Agent (${this.settings.codeModel}): ${task}`);

                    // Call GeminiService
                    const codeResult = await this.gemini.solveWithCode(task);
                    result = { result: codeResult };
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error("Code sub-agent failed", e);
                result = { error: `Calculation failed: ${message}` };
            }
        } else {
            result = { error: "Tool not found." };
        }

        return result;
    }

    /**
     * Conducts a chat session with the agent, handling tool calling loops.
     * @param history - The chat history.
     * @param message - The user's latest message.
     * @param contextFiles - Optional list of files to inject into context (e.g. active file).
     * @param options - Optional overrides for model and capabilities.
     * @returns The final response from the agent.
     */
    public async chat(
        history: ChatMessage[],
        message: string,
        contextFiles: TFile[] = [],
        options: { modelId?: string; enableCodeExecution?: boolean } = {}
    ): Promise<{ text: string; files: string[] }> {
        // Auto-inject active file(s) if none provided
        if (contextFiles.length === 0) {
            this.app.workspace.iterateRootLeaves((leaf) => {
                const view = leaf.view;
                if (view instanceof MarkdownView) {
                    const file = view.file;
                    if (file) {
                        // Check if already added to avoid duplicates from split views of same file
                        if (!contextFiles.some(f => f.path === file.path)) {
                            contextFiles.push(file);
                        }
                    }
                }
            });

            if (contextFiles.length > 0) {
                logger.info(`[Agent] Auto-injected ${contextFiles.length} visible files into context.`);
            }
        }

        // Initialize used files tracker with explicit context files
        const usedFiles = new Set<string>();
        contextFiles.forEach(f => usedFiles.add(f.path));

        const formattedHistory = history.map(h => ({
            parts: [{ text: h.text }],
            role: h.role as "user" | "model"
        })) as Content[];

        if (contextFiles.length > 0) {
            // Map files to VaultSearchResult format for assembler
            // We treat explicit/open files with a perfect score (1.0) to prioritize them
            const fileResults: VaultSearchResult[] = contextFiles.map(f => ({
                isKeywordMatch: true,
                path: f.path,
                score: 1.0
            }));

            // Assemble intelligently respecting budget
            const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
            const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

            const { context } = await this.contextAssembler.assemble(fileResults, message, totalCharBudget);

            if (context) {
                message = `The following notes were automatically injected from your workspace context:\n${context}\n\nUser Query: ${message}`;
            }
        }

        const currentDate = new Date().toDateString();
        const rawSystemInstruction = this.settings.systemInstruction || DEFAULT_SETTINGS.systemInstruction;

        // Replace {{DATE}} placeholder
        const systemInstruction = rawSystemInstruction.replace("{{DATE}}", currentDate);

        const chat = await this.gemini.startChat(formattedHistory, this.getTools(options.enableCodeExecution), systemInstruction, options.modelId);

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
                        const functionResponse = await this.executeFunction(call.name, args, usedFiles, options.enableCodeExecution);

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
                return {
                    files: Array.from(usedFiles),
                    text: "I'm sorry, I searched through your notes but couldn't find a definitive answer within the step limit. You might try rephrasing your query or increasing the 'Max agent steps' setting."
                };
            }

            return { files: Array.from(usedFiles), text: result.text || "" };

        } catch (e: unknown) {
            logger.error("Error in chat loop", e);
            const errorMessage = e instanceof Error ? e.message : String(e);

            // Check for common 400 errors (API key, etc)
            if (errorMessage.includes("400") || errorMessage.includes("API key")) {
                return {
                    files: [],
                    text: `I encountered an error connecting to Gemini (Status 400). Please check that your API key is valid and has not expired.\n\nError details: ${errorMessage}`
                };
            }

            return { files: [], text: `Sorry, I encountered an error processing your request: ${errorMessage}` };
        }
    }
}