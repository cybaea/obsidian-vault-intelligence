import { Type, Part, Tool, Content, FunctionDeclaration } from "@google/genai";
import { TFile, App, requestUrl, MarkdownView } from "obsidian";

import { SEARCH_CONSTANTS, AGENT_CONSTANTS } from "../constants";
import { ToolConfirmationModal } from "../modals/ToolConfirmationModal";
import { GraphService } from "../services/GraphService";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";
import { FileTools } from "../tools/FileTools";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { ContextAssembler } from "./ContextAssembler";
import { GeminiService } from "./GeminiService";
import { IEmbeddingService } from "./IEmbeddingService";
import { SearchOrchestrator } from "./SearchOrchestrator";

export interface ChatMessage {
    contextFiles?: string[];
    createdFiles?: string[];
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
    private fileTools: FileTools;

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
        this.fileTools = new FileTools(app);
    }

    /**
     * Constructs the list of tools available to the agent.
     * Includes vault search, URL reading, Google search, and optionally code execution.
     * @param enableCodeExecution - Optional override for code execution enablement.
     * @returns Array of Tool definitions compatible with Google GenAI.
     */
    private getTools(enableCodeExecution?: boolean): Tool[] {
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

        // 6. Create Note
        const createNote: FunctionDeclaration = {
            description: "Create a new note in the vault. Will create parent folders recursively if they don't exist.",
            name: AGENT_CONSTANTS.TOOLS.CREATE_NOTE,
            parameters: {
                properties: {
                    content: { description: "The markdown content of the note. Do NOT include frontmatter.", type: Type.STRING },
                    path: { description: "The vault-absolute path where the note should be created (e.g., 'Projects/Project A/Meeting.md').", type: Type.STRING }
                },
                required: ["path", "content"],
                type: Type.OBJECT
            }
        };

        // 7. Update Note
        const updateNote: FunctionDeclaration = {
            description: "Update an existing note in the vault.",
            name: AGENT_CONSTANTS.TOOLS.UPDATE_NOTE,
            parameters: {
                properties: {
                    content: { description: "The new content or text to add.", type: Type.STRING },
                    mode: { description: "How to update: 'append' (add to end), 'prepend' (add to start), or 'overwrite' (replace entirely).", enum: ["append", "prepend", "overwrite"], type: Type.STRING },
                    path: { description: "The vault-absolute path of the note.", type: Type.STRING }
                },
                required: ["path", "content", "mode"],
                type: Type.OBJECT
            }
        };

        // 8. Rename/Move Note
        const renameNote: FunctionDeclaration = {
            description: "Rename or move a note. Updates all internal links automatically.",
            name: AGENT_CONSTANTS.TOOLS.RENAME_NOTE,
            parameters: {
                properties: {
                    newPath: { description: "The new vault-absolute path.", type: Type.STRING },
                    path: { description: "The current vault-absolute path.", type: Type.STRING }
                },
                required: ["path", "newPath"],
                type: Type.OBJECT
            }
        };

        // 9. Create Folder
        const createFolder: FunctionDeclaration = {
            description: "Create a new folder path recursively.",
            name: AGENT_CONSTANTS.TOOLS.CREATE_FOLDER,
            parameters: {
                properties: {
                    path: { description: "The folder path to create.", type: Type.STRING }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        };

        // 10. List Folder
        const listFolder: FunctionDeclaration = {
            description: "List the contents of a folder.",
            name: AGENT_CONSTANTS.TOOLS.LIST_FOLDER,
            parameters: {
                properties: {
                    folderPath: { description: "The folder path to list.", type: Type.STRING }
                },
                required: ["folderPath"],
                type: Type.OBJECT
            }
        };

        // 11. Read Note
        const readNote: FunctionDeclaration = {
            description: "Read the full raw content of a note. Use this if you need to refactor or see the complete text of a file.",
            name: AGENT_CONSTANTS.TOOLS.READ_NOTE,
            parameters: {
                properties: {
                    path: { description: "The vault-absolute path of the note.", type: Type.STRING }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        };

        toolsList.push(createNote, updateNote, renameNote, createFolder, listFolder, readNote);

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
    private async executeFunction(
        name: string,
        args: Record<string, unknown>,
        usedFiles: Set<string>,
        createdFiles: Set<string>,
        enableCodeExecution?: boolean,
        enableAgentWriteAccess?: boolean
    ): Promise<Record<string, unknown>> {
        logger.info(`Executing tool ${name} with args:`, args);

        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;
        const isWriteEnabled = enableAgentWriteAccess !== undefined ? enableAgentWriteAccess : this.settings.enableAgentWriteAccess;
        let result: Record<string, unknown>;

        if (name === AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH) {
            try {
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
            const rawQuery = args.query;
            const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

            if (!query || query.trim().length === 0) {
                result = { result: "Error: Search query was empty." };
            } else {
                const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
                const limit = Math.max(0, Math.trunc(rawLimit));

                const results = await this.searchOrchestrator.search(query, limit);

                if (results.length === 0) {
                    result = { result: "No relevant notes found." };
                } else {
                    const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
                    const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

                    const { context, usedFiles: resultFiles } = await this.contextAssembler.assemble(results, query, totalCharBudget);

                    if (!context) {
                        result = { result: "No relevant notes found or context budget exceeded." };
                    } else {
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
                if (!isCodeEnabled) {
                    result = { error: "Code execution tool is disabled." };
                } else {
                    const task = args.task as string;
                    logger.info(`Delegating to Code Sub-Agent (${this.settings.codeModel}): ${task}`);
                    const codeResult = await this.gemini.solveWithCode(task);
                    result = { result: codeResult };
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error("Code sub-agent failed", e);
                result = { error: `Calculation failed: ${message}` };
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.CREATE_NOTE ||
            name === AGENT_CONSTANTS.TOOLS.UPDATE_NOTE ||
            name === AGENT_CONSTANTS.TOOLS.RENAME_NOTE ||
            name === AGENT_CONSTANTS.TOOLS.CREATE_FOLDER) {

            if (!isWriteEnabled) {
                return { error: "Agent write access is disabled. The user must enable 'Write' in the chat view or globally in plugin settings." };
            }

            const targetPath = (args.path as string || args.newPath as string || "").toLowerCase();
            const isExcluded = this.settings.excludedFolders.some(folder => {
                const normalizedFolder = folder.toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
                return targetPath.startsWith(normalizedFolder + "/") || targetPath === normalizedFolder;
            });

            if (isExcluded) {
                return { error: `Permission Denied: Agent is not allowed to write to excluded folder: ${targetPath}` };
            }

            let action: "create" | "update" | "rename" | "folder";
            switch (name) {
                case AGENT_CONSTANTS.TOOLS.CREATE_NOTE: action = "create"; break;
                case AGENT_CONSTANTS.TOOLS.UPDATE_NOTE: action = "update"; break;
                case AGENT_CONSTANTS.TOOLS.RENAME_NOTE: action = "rename"; break;
                case AGENT_CONSTANTS.TOOLS.CREATE_FOLDER: action = "folder"; break;
                default: action = "create";
            }

            const confirmedDetails = await ToolConfirmationModal.open(this.app, {
                action,
                content: args.content as string,
                mode: args.mode as string,
                newPath: args.newPath as string,
                path: args.path as string,
                tool: name
            });

            if (!confirmedDetails) {
                return { error: "User cancelled the action." };
            }

            try {
                let successMessage: string;
                switch (name) {
                    case AGENT_CONSTANTS.TOOLS.CREATE_NOTE: {
                        successMessage = await this.fileTools.createNote(confirmedDetails.path, confirmedDetails.content || "");
                        const normalizedPath = confirmedDetails.path.endsWith(".md") ? confirmedDetails.path : confirmedDetails.path + ".md";
                        createdFiles.add(normalizedPath);

                        // Automatically open new note in a new tab
                        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
                        if (file instanceof TFile) {
                            await this.app.workspace.getLeaf("tab").openFile(file);
                        }
                        break;
                    }
                    case AGENT_CONSTANTS.TOOLS.UPDATE_NOTE: {
                        successMessage = await this.fileTools.updateNote(confirmedDetails.path, confirmedDetails.content || "", confirmedDetails.mode as "append" | "prepend" | "overwrite");
                        const normalizedPath = confirmedDetails.path.endsWith(".md") ? confirmedDetails.path : confirmedDetails.path + ".md";
                        createdFiles.add(normalizedPath);
                        break;
                    }
                    case AGENT_CONSTANTS.TOOLS.RENAME_NOTE: {
                        successMessage = await this.fileTools.renameNote(confirmedDetails.path, confirmedDetails.newPath || "");
                        const normalizedPath = (confirmedDetails.newPath || "").endsWith(".md") ? (confirmedDetails.newPath || "") : (confirmedDetails.newPath || "") + ".md";
                        createdFiles.add(normalizedPath);
                        break;
                    }
                    case AGENT_CONSTANTS.TOOLS.CREATE_FOLDER:
                        successMessage = await this.fileTools.createFolder(confirmedDetails.path);
                        break;
                    default:
                        throw new Error("Invalid write tool");
                }
                result = { result: successMessage };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                result = { error: `Failed to execute ${name}: ${message}` };
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.LIST_FOLDER) {
            try {
                const message = this.fileTools.listFolder(args.folderPath as string);
                result = { result: message };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                result = { error: `Failed to list folder: ${message}` };
            }
        } else if (name === AGENT_CONSTANTS.TOOLS.READ_NOTE) {
            try {
                const content = await this.fileTools.readNote(args.path as string);
                result = { result: content };
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                result = { error: `Failed to read note: ${message}` };
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
        options: { modelId?: string; enableCodeExecution?: boolean; enableAgentWriteAccess?: boolean } = {}
    ): Promise<{ createdFiles: string[]; files: string[]; text: string }> {
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

        // Initialize files trackers
        const usedFiles = new Set<string>();
        const createdFiles = new Set<string>();
        contextFiles.forEach(f => usedFiles.add(f.path));

        const formattedHistory = history.map(h => ({
            parts: [{ text: h.text }],
            role: h.role as "user" | "model"
        })) as Content[];

        if (contextFiles.length > 0) {
            // Map files to VaultSearchResult format for assembler
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
                        const functionResponse = await this.executeFunction(call.name, args, usedFiles, createdFiles, options.enableCodeExecution, options.enableAgentWriteAccess);

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
                    createdFiles: Array.from(createdFiles),
                    files: Array.from(usedFiles),
                    text: "I'm sorry, I searched through your notes but couldn't find a definitive answer within the step limit. You might try rephrasing your query or increasing the 'Max agent steps' setting."
                };
            }

            return { createdFiles: Array.from(createdFiles), files: Array.from(usedFiles), text: result.text || "" };

        } catch (e: unknown) {
            logger.error("Error in chat loop", e);
            const errorMessage = e instanceof Error ? e.message : String(e);

            // Check for common 400 errors (API key, etc)
            if (errorMessage.includes("400") || errorMessage.includes("API key")) {
                return {
                    createdFiles: [],
                    files: [],
                    text: `I encountered an error connecting to Gemini (Status 400). Please check that your API key is valid and has not expired.\n\nError details: ${errorMessage}`
                };
            }

            return {
                createdFiles: [],
                files: [],
                text: `Sorry, I encountered an error processing your request: ${errorMessage}`
            };
        }
    }
}