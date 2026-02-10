import { Tool, FunctionDeclaration, Type } from "@google/genai";
import { App, normalizePath, TFile, requestUrl } from "obsidian";

import { AGENT_CONSTANTS } from "../constants";
import { SEARCH_CONSTANTS } from "../constants";
import { ToolConfirmationModal } from "../modals/ToolConfirmationModal";
import { ContextAssembler } from "../services/ContextAssembler";
import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { SearchOrchestrator } from "../services/SearchOrchestrator";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS } from "../settings";
import { logger } from "../utils/logger";
import { FileTools } from "./FileTools";

export interface ToolExecutionParams {
    args: Record<string, unknown>;
    createdFiles: Set<string>;
    enableAgentWriteAccess?: boolean;
    enableCodeExecution?: boolean;
    name: string;
    usedFiles: Set<string>;
}

export class ToolRegistry {
    private app: App;
    private settings: VaultIntelligenceSettings;
    private gemini: GeminiService;
    private graphService: GraphService;
    private searchOrchestrator: SearchOrchestrator;
    private contextAssembler: ContextAssembler;
    private fileTools: FileTools;

    constructor(
        app: App,
        settings: VaultIntelligenceSettings,
        gemini: GeminiService,
        graphService: GraphService,
        searchOrchestrator: SearchOrchestrator,
        contextAssembler: ContextAssembler,
        fileTools: FileTools
    ) {
        this.app = app;
        this.settings = settings;
        this.gemini = gemini;
        this.graphService = graphService;
        this.searchOrchestrator = searchOrchestrator;
        this.contextAssembler = contextAssembler;
        this.fileTools = fileTools;
    }

    /**
     * Returns the list of available tools types for the Google GenAI model.
     */
    public getTools(enableCodeExecution?: boolean): Tool[] {
        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;
        const tools: FunctionDeclaration[] = [];

        // 1. Vault Search
        tools.push({
            description: "Search the user's personal Obsidian notes (vault) for information and context.",
            name: AGENT_CONSTANTS.TOOLS.VAULT_SEARCH,
            parameters: {
                properties: {
                    query: { description: "The search query to find relevant notes.", type: Type.STRING }
                },
                required: ["query"],
                type: Type.OBJECT
            }
        });

        // 2. URL Reader
        tools.push({
            description: "Read the content of a specific external URL.",
            name: AGENT_CONSTANTS.TOOLS.URL_READER,
            parameters: {
                properties: {
                    url: { description: "The full URL to read.", type: Type.STRING }
                },
                required: ["url"],
                type: Type.OBJECT
            }
        });

        // 3. Google Search
        tools.push({
            description: "Perform a Google search to find the latest real-world information, facts, dates, or news.",
            name: AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH,
            parameters: {
                properties: { query: { type: Type.STRING } },
                required: ["query"],
                type: Type.OBJECT
            }
        });

        // 4. Graph Explorer
        tools.push({
            description: "Find notes linked to or from a specific note. Use this to discover context not immediately visible in search results.",
            name: AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES,
            parameters: {
                properties: {
                    path: { description: "The path of the note to find connections for.", type: Type.STRING }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        });

        // 5. Computational Solver
        if (isCodeEnabled && this.settings.codeModel.trim().length > 0) {
            tools.push({
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
            });
        }

        // 6. Write Operations
        tools.push({
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
        });

        tools.push({
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
        });

        tools.push({
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
        });

        tools.push({
            description: "Create a new folder path recursively.",
            name: AGENT_CONSTANTS.TOOLS.CREATE_FOLDER,
            parameters: {
                properties: {
                    path: { description: "The folder path to create.", type: Type.STRING }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        });

        tools.push({
            description: "List the contents of a folder.",
            name: AGENT_CONSTANTS.TOOLS.LIST_FOLDER,
            parameters: {
                properties: {
                    folderPath: { description: "The folder path to list.", type: Type.STRING }
                },
                required: ["folderPath"],
                type: Type.OBJECT
            }
        });

        tools.push({
            description: "Read the full raw content of a note. Use this if you need to refactor or see the complete text of a file.",
            name: AGENT_CONSTANTS.TOOLS.READ_NOTE,
            parameters: {
                properties: {
                    path: { description: "The vault-absolute path of the note.", type: Type.STRING }
                },
                required: ["path"],
                type: Type.OBJECT
            }
        });

        return [{ functionDeclarations: tools }];
    }

    /**
     * Executes a tool by name.
     */
    public async execute(params: ToolExecutionParams): Promise<Record<string, unknown>> {
        const { args, createdFiles, enableAgentWriteAccess, enableCodeExecution, name, usedFiles } = params;
        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;
        const isWriteEnabled = enableAgentWriteAccess !== undefined ? enableAgentWriteAccess : this.settings.enableAgentWriteAccess;

        logger.info(`Executing tool ${name} with args:`, args);

        try {
            switch (name) {
                case AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH:
                    return await this.executeGoogleSearch(args);

                case AGENT_CONSTANTS.TOOLS.VAULT_SEARCH:
                    return await this.executeVaultSearch(args, usedFiles);

                case AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES:
                    return await this.executeGraphExplorer(args);

                case AGENT_CONSTANTS.TOOLS.URL_READER:
                    return await this.executeUrlReader(args);

                case AGENT_CONSTANTS.TOOLS.CALCULATOR:
                    return await this.executeCalculator(args, isCodeEnabled);

                case AGENT_CONSTANTS.TOOLS.CREATE_NOTE:
                case AGENT_CONSTANTS.TOOLS.UPDATE_NOTE:
                case AGENT_CONSTANTS.TOOLS.RENAME_NOTE:
                case AGENT_CONSTANTS.TOOLS.CREATE_FOLDER:
                    return await this.executeWriteOperation(name, args, createdFiles, isWriteEnabled);

                case AGENT_CONSTANTS.TOOLS.LIST_FOLDER:
                    return { result: this.fileTools.listFolder(args.folderPath as string) };

                case AGENT_CONSTANTS.TOOLS.READ_NOTE:
                    return { result: await this.fileTools.readNote(args.path as string) };

                default:
                    return { error: "Tool not found." };
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to execute ${name}`, e);
            return { error: `Failed to execute ${name}: ${message}` };
        }
    }

    private async executeGoogleSearch(args: Record<string, unknown>) {
        const rawQuery = args.query;
        const query = typeof rawQuery === 'string' ? rawQuery : JSON.stringify(rawQuery);
        logger.info(`Delegating search to sub-agent for: ${query}`);
        const searchResult = await this.gemini.searchWithGrounding(query);
        return { result: searchResult };
    }

    private async executeVaultSearch(args: Record<string, unknown>, usedFiles: Set<string>) {
        const rawQuery = args.query;
        const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

        if (!query || query.trim().length === 0) {
            return { result: "Error: Search query was empty." };
        }

        const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
        const limit = Math.max(0, Math.trunc(rawLimit));

        const results = await this.searchOrchestrator.search(query, limit, { deep: false });

        if (results.length === 0) {
            return { result: "No relevant notes found." };
        }

        const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
        const totalCharBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

        const { context, usedFiles: resultFiles } = await this.contextAssembler.assemble(results, query, totalCharBudget);

        if (!context) {
            return { result: "No relevant notes found or context budget exceeded." };
        }

        resultFiles.forEach(f => usedFiles.add(f));
        return { result: context };
    }

    private async executeGraphExplorer(args: Record<string, unknown>) {
        const path = (args.path as string) || '';
        if (!path) return { error: "Path argument is required." };

        const neighbors = await this.graphService.getNeighbors(path);
        if (neighbors.length === 0) {
            return { result: `No connected notes found for: ${path}` };
        }

        const list = neighbors.map(n => `- ${n.path} (Title: ${n.title})`).join('\n');
        return { result: `The following notes are directly connected to ${path}:\n${list}\n\nYou can use vault_search or read their content to explore further.` };
    }

    private async executeUrlReader(args: Record<string, unknown>) {
        // Dynamic import logic removed - using static requestUrl
        const url = args.url as string;
        const res = await requestUrl({ url });
        return { result: res.text.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) };
    }

    private async executeCalculator(args: Record<string, unknown>, isCodeEnabled: boolean) {
        if (!isCodeEnabled) return { error: "Code execution tool is disabled." };

        const task = args.task as string;
        logger.info(`Delegating to Code Sub-Agent (${this.settings.codeModel}): ${task}`);
        const codeResult = await this.gemini.solveWithCode(task);
        return { result: codeResult };
    }

    private async executeWriteOperation(name: string, args: Record<string, unknown>, createdFiles: Set<string>, isWriteEnabled: boolean) {
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

        // Normalize paths
        // Normalize paths
        const confirmedPath = normalizePath(confirmedDetails.path);
        const confirmedNewPath = confirmedDetails.newPath ? normalizePath(confirmedDetails.newPath) : "";

        let successMessage: string;
        switch (name) {
            case AGENT_CONSTANTS.TOOLS.CREATE_NOTE: {
                successMessage = await this.fileTools.createNote(confirmedPath, confirmedDetails.content || "");
                const normalizedPath = confirmedPath.endsWith(".md") ? confirmedPath : confirmedPath + ".md";
                createdFiles.add(normalizedPath);

                // Open new note
                const file = this.app.vault.getAbstractFileByPath(normalizedPath);
                if (file instanceof TFile) {
                    await this.app.workspace.getLeaf("tab").openFile(file);
                }
                break;
            }
            case AGENT_CONSTANTS.TOOLS.UPDATE_NOTE: {
                successMessage = await this.fileTools.updateNote(confirmedPath, confirmedDetails.content || "", confirmedDetails.mode as "append" | "prepend" | "overwrite");
                const normalizedPath = confirmedPath.endsWith(".md") ? confirmedPath : confirmedPath + ".md";
                createdFiles.add(normalizedPath);
                break;
            }
            case AGENT_CONSTANTS.TOOLS.RENAME_NOTE: {
                successMessage = await this.fileTools.renameNote(confirmedPath, confirmedNewPath);
                const normalizedPath = confirmedNewPath.endsWith(".md") ? confirmedNewPath : confirmedNewPath + ".md";
                createdFiles.add(normalizedPath);
                break;
            }
            case AGENT_CONSTANTS.TOOLS.CREATE_FOLDER:
                successMessage = await this.fileTools.createFolder(confirmedPath);
                break;
            default:
                throw new Error("Invalid write tool");
        }
        return { result: successMessage };
    }
}
