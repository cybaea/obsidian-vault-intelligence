import { IEmbeddingService } from "./IEmbeddingService";
import { GraphService } from "../services/GraphService";
import { GeminiService } from "./GeminiService";
import { TFile, App, requestUrl, MarkdownView } from "obsidian";
import { Type, Part, Tool, Content, FunctionDeclaration } from "@google/genai";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";
import { SEARCH_CONSTANTS, AGENT_CONSTANTS } from "../constants";
import { SearchOrchestrator } from "./SearchOrchestrator";
import { ContextAssembler } from "./ContextAssembler";

export interface ChatMessage {
    role: "user" | "model" | "system";
    text: string;
    thought?: string;
    contextFiles?: string[];
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
        this.searchOrchestrator = new SearchOrchestrator(app, graphService);
        this.contextAssembler = new ContextAssembler(app);
    }

    /**
     * Constructs the list of tools available to the agent.
     * Includes vault search, URL reading, Google search, and optionally code execution.
     * @returns Array of Tool definitions compatible with Google GenAI.
     */
    private getTools(): Tool[] {
        // 1. Vault Search
        const vaultSearch: FunctionDeclaration = {
            name: AGENT_CONSTANTS.TOOLS.VAULT_SEARCH,
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
            name: AGENT_CONSTANTS.TOOLS.URL_READER,
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
            name: AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH,
            description: "Perform a Google search to find the latest real-world information, facts, dates, or news.",
            parameters: {
                type: Type.OBJECT,
                properties: { query: { type: Type.STRING } },
                required: ["query"]
            }
        };

        // 4. Graph Explorer
        const graphExplorer: FunctionDeclaration = {
            name: AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES,
            description: "Find notes linked to or from a specific note. Use this to discover context not immediately visible in search results.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    path: {
                        type: Type.STRING,
                        description: "The path of the note to find connections for."
                    }
                },
                required: ["path"]
            }
        };

        const toolsList: FunctionDeclaration[] = [vaultSearch, urlReader, googleSearch, graphExplorer];

        // 5. Computational Solver (Conditional)
        if (this.settings.enableCodeExecution && this.settings.codeModel.trim().length > 0) {
            const computationalSolver: FunctionDeclaration = {
                name: AGENT_CONSTANTS.TOOLS.CALCULATOR,
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
     * Executes a tool called by the LLM.
     * @param name - The name of the tool to execute.
     * @param args - The arguments provided by the LLM.
     * @returns A promise resolving to the tool's output.
     */
    private async executeFunction(name: string, args: Record<string, unknown>, usedFiles: Set<string>): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        if (name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH) {
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

        if (name === AGENT_CONSTANTS.TOOLS.VAULT_SEARCH) {
            // Safety: Ensure query is a string
            const rawQuery = args.query;
            const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

            if (!query || query.trim().length === 0) {
                logger.warn("Vault search called with empty query.");
                return { result: "Error: Search query was empty." };
            }

            // 1. Search (Delegated to Orchestrator)
            const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
            const limit = Math.max(0, Math.trunc(rawLimit));

            const results = await this.searchOrchestrator.search(query, limit);

            if (results.length === 0) return { result: "No relevant notes found." };

            // 2. Assemble Context (Delegated to Assembler)
            const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
            const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

            const { context, usedFiles: resultFiles } = await this.contextAssembler.assemble(results, query, totalCharBudget);

            if (!context) return { result: "No relevant notes found or context budget exceeded." };

            // Track files used
            resultFiles.forEach(f => usedFiles.add(f));

            return { result: context };
        }

        if (name === AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES) {
            const path = (args.path as string) || '';
            if (!path) return { error: "Path argument is required." };

            const neighbors = await this.graphService.getNeighbors(path);
            if (neighbors.length === 0) return { result: `No connected notes found for: ${path}` };

            const list = neighbors.map(n => `- ${n.path} (Title: ${n.title})`).join('\n');
            return { result: `The following notes are directly connected to ${path}:\n${list}\n\nYou can use vault_search or read their content to explore further.` };
        }

        if (name === AGENT_CONSTANTS.TOOLS.URL_READER) {
            try {
                const url = args.url as string;
                const res = await requestUrl({ url });
                return { result: res.text.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                return { error: `Failed to read URL: ${message}` };
            }
        }

        if (name === AGENT_CONSTANTS.TOOLS.CALCULATOR) {
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

    /**
     * Conducts a chat session with the agent, handling tool calling loops.
     * @param history - The chat history.
     * @param message - The user's latest message.
     * @param contextFiles - Optional list of files to inject into context (e.g. active file).
     * @returns The final response from the agent.
     */
    public async chat(history: ChatMessage[], message: string, contextFiles: TFile[] = []): Promise<{ text: string; files: string[] }> {
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
                        const functionResponse = await this.executeFunction(call.name, args, usedFiles);

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
                    text: "I'm sorry, I searched through your notes but couldn't find a definitive answer within the step limit. You might try rephrasing your query or increasing the 'Max agent steps' setting.",
                    files: Array.from(usedFiles)
                };
            }

            return { text: result.text || "", files: Array.from(usedFiles) };

        } catch (e: unknown) {
            logger.error("Error in chat loop", e);
            const errorMessage = e instanceof Error ? e.message : String(e);

            // Check for common 400 errors (API key, etc)
            if (errorMessage.includes("400") || errorMessage.includes("API key")) {
                return {
                    text: `I encountered an error connecting to Gemini (Status 400). Please check that your API key is valid and has not expired.\n\nError details: ${errorMessage}`,
                    files: []
                };
            }

            return { text: `Sorry, I encountered an error processing your request: ${errorMessage}`, files: [] };
        }
    }
}