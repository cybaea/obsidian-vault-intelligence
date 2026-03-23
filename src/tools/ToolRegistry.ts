import { App, normalizePath, TFile, requestUrl } from "obsidian";

import { AGENT_CONSTANTS, SEARCH_CONSTANTS, SANITIZATION_CONSTANTS, MCP_CONSTANTS } from "../constants";
import { ToolConfirmationModal } from "../modals/ToolConfirmationModal";
import { ContextAssembler } from "../services/ContextAssembler";
import { GraphService } from "../services/GraphService";
import { McpClientManager } from "../services/McpClientManager";
import { ModelRegistry } from "../services/ModelRegistry";
import { SearchOrchestrator } from "../services/SearchOrchestrator";
import { DEFAULT_SETTINGS, VaultIntelligenceSettings } from "../settings";
import { IModelProvider, IReasoningClient, IToolDefinition } from "../types/providers";
import { truncateJsonStrings, JsonValue } from "../utils/json";
import { logger } from "../utils/logger";
import { isExternalUrl } from "../utils/url";
import { FileTools } from "./FileTools";

export interface ToolExecutionParams {
    args: Record<string, unknown>;
    createdFiles: Set<string>;
    enableAgentWriteAccess?: boolean;
    enableCodeExecution?: boolean;
    modelId?: string;
    name: string;
    signal?: AbortSignal;
    usedFiles: Set<string>;
}

export class ToolRegistry {
    private app: App;
    private settings: VaultIntelligenceSettings;
    private reasoningClient: IReasoningClient; 
    private provider: IModelProvider;
    private graphService: GraphService;
    private searchOrchestrator: SearchOrchestrator;
    private contextAssembler: ContextAssembler;
    private fileTools: FileTools;
    private mcpClientManager: McpClientManager;

    constructor(
        app: App,
        settings: VaultIntelligenceSettings,
        reasoningClient: IReasoningClient,
        provider: IModelProvider,
        graphService: GraphService,
        searchOrchestrator: SearchOrchestrator,
        contextAssembler: ContextAssembler,
        fileTools: FileTools,
        mcpClientManager: McpClientManager
    ) {
        this.app = app;
        this.settings = settings;
        this.reasoningClient = reasoningClient;
        this.provider = provider;
        this.graphService = graphService;
        this.searchOrchestrator = searchOrchestrator;
        this.contextAssembler = contextAssembler;
        this.fileTools = fileTools;
        this.mcpClientManager = mcpClientManager;
    }

    /**
     * Updates the reasoning client and provider used by the registry.
     * Needed when switching between local and cloud providers dynamically.
     */
    public updateProvider(reasoningClient: IReasoningClient, provider: IModelProvider): void {
        this.reasoningClient = reasoningClient;
        this.provider = provider;
        this.searchOrchestrator.updateReasoningClient(reasoningClient);
    }

    /**
     * Returns the list of available tools types abstracted from SDKs, including dynamically fetched MCP tools.
     */
    public async getTools(options: { enableCodeExecution?: boolean, enableWebSearch?: boolean } = {}): Promise<IToolDefinition[]> {
        if (!this.provider.supportsTools) {
             return [];
        }

        const isCodeEnabled = options.enableCodeExecution !== undefined ? options.enableCodeExecution : this.settings.enableCodeExecution;
        const isWebSearchEnabled = options.enableWebSearch !== undefined ? options.enableWebSearch : this.settings.enableWebSearch;
        const tools: IToolDefinition[] = [];

        // 1. Vault Search
        tools.push({
            description: "Search the user's personal Obsidian notes (vault) for information and context.",
            name: AGENT_CONSTANTS.TOOLS.VAULT_SEARCH,
            parameters: {
                properties: {
                    query: { description: "The search query to find relevant notes.", type: "string" }
                },
                required: ["query"],
                type: "object"
            }
        });

        // 2. URL Reader
        tools.push({
            description: "Read the content of a specific external URL.",
            name: AGENT_CONSTANTS.TOOLS.URL_READER,
            parameters: {
                properties: {
                    url: { description: "The full URL to read.", type: "string" }
                },
                required: ["url"],
                type: "object"
            }
        });

        // 3. Google Search (Gated by provider capability)
        if (isWebSearchEnabled && this.provider.supportsWebGrounding) {
            tools.push({
                description: "Perform a Google search to find the latest real-world information, facts, dates, or news.",
                name: AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH,
                parameters: {
                    properties: { query: { type: "string" } },
                    required: ["query"],
                    type: "object"
                }
            });
        }

        // 4. Graph Explorer
        tools.push({
            description: "Find notes linked to or from a specific note. Use this to discover context not immediately visible in search results.",
            name: AGENT_CONSTANTS.TOOLS.GET_CONNECTED_NOTES,
            parameters: {
                properties: {
                    path: { description: "The path of the note to find connections for.", type: "string" }
                },
                required: ["path"],
                type: "object"
            }
        });

        // 5. Computational Solver (Gated by Code settings but may eventually be provider capability)
        if (isCodeEnabled && this.provider.supportsCodeExecution && this.settings.codeModel.trim().length > 0) {
            tools.push({
                description: "Use this tool to solve math problems, perform complex logic, or analyze data using code execution.",
                name: AGENT_CONSTANTS.TOOLS.CALCULATOR,
                parameters: {
                    properties: {
                        task: {
                            description: "The math problem or logic task to solve (e.g., 'Calculate the 50th Fibonacci number').",
                            type: "string"
                        }
                    },
                    required: ["task"],
                    type: "object"
                }
            });
        }

        // 6. Write Operations
        tools.push({
            description: "Create a new note in the vault. Will create parent folders recursively if they don't exist.",
            name: AGENT_CONSTANTS.TOOLS.CREATE_NOTE,
            parameters: {
                properties: {
                    content: { description: "The markdown content of the note. Do NOT include frontmatter.", type: "string" },
                    path: { description: "The vault-absolute path where the note should be created (e.g., 'Projects/Project A/Meeting.md').", type: "string" }
                },
                required: ["path", "content"],
                type: "object"
            }
        });

        tools.push({
            description: "Update an existing note in the vault.",
            name: AGENT_CONSTANTS.TOOLS.UPDATE_NOTE,
            parameters: {
                properties: {
                    content: { description: "The new content or text to add.", type: "string" },
                    mode: { description: "How to update: 'append' (add to end), 'prepend' (add to start), or 'overwrite' (replace entirely).", enum: ["append", "prepend", "overwrite"], type: "string" },
                    path: { description: "The vault-absolute path of the note.", type: "string" }
                },
                required: ["path", "content", "mode"],
                type: "object"
            }
        });

        tools.push({
            description: "Rename or move a note. Updates all internal links automatically.",
            name: AGENT_CONSTANTS.TOOLS.RENAME_NOTE,
            parameters: {
                properties: {
                    newPath: { description: "The new vault-absolute path.", type: "string" },
                    path: { description: "The current vault-absolute path.", type: "string" }
                },
                required: ["path", "newPath"],
                type: "object"
            }
        });

        tools.push({
            description: "Create a new folder path recursively.",
            name: AGENT_CONSTANTS.TOOLS.CREATE_FOLDER,
            parameters: {
                properties: {
                    path: { description: "The folder path to create.", type: "string" }
                },
                required: ["path"],
                type: "object"
            }
        });

        tools.push({
            description: "List the contents of a folder.",
            name: AGENT_CONSTANTS.TOOLS.LIST_FOLDER,
            parameters: {
                properties: {
                    folderPath: { description: "The folder path to list.", type: "string" }
                },
                required: ["folderPath"],
                type: "object"
            }
        });

        tools.push({
            description: "Read the full raw content of a note. Use this if you need to refactor or see the complete text of a file.",
            name: AGENT_CONSTANTS.TOOLS.READ_NOTE,
            parameters: {
                properties: {
                    path: { description: "The vault-absolute path of the note.", type: "string" }
                },
                required: ["path"],
                type: "object"
            }
        });

        // 8. Fetch and merge active MCP tools
        const mcpTools = await this.mcpClientManager.getAvailableTools();
        tools.push(...mcpTools);

        // 9. MCP Resource Management
        tools.push({
            description: "List all available external resources provided by connected MCP servers (e.g., files, database schemas, etc.). Use this to discover what resources you can read.",
            name: AGENT_CONSTANTS.TOOLS.LIST_MCP_RESOURCES,
            parameters: {
                properties: {},
                type: "object"
            }
        });

        tools.push({
            description: "Read the content of a specific MCP resource. You must provide the serverId and uri obtained from the list_mcp_resources tool.",
            name: AGENT_CONSTANTS.TOOLS.READ_MCP_RESOURCE,
            parameters: {
                properties: {
                    serverId: { description: "The ID of the MCP server providing the resource.", type: "string" },
                    uri: { description: "The URI of the resource to read.", type: "string" }
                },
                required: ["serverId", "uri"],
                type: "object"
            }
        });

        return tools;
    }

    /**
     * Executes a tool by name.
     */
    public async execute(params: ToolExecutionParams): Promise<Record<string, unknown>> {
        const { args, createdFiles, enableAgentWriteAccess, enableCodeExecution, modelId, name, usedFiles } = params;
        const isCodeEnabled = enableCodeExecution !== undefined ? enableCodeExecution : this.settings.enableCodeExecution;
        const isWriteEnabled = enableAgentWriteAccess !== undefined ? enableAgentWriteAccess : this.settings.enableAgentWriteAccess;

        logger.info(`Executing tool ${name} with args:`, truncateJsonStrings(args as JsonValue, SANITIZATION_CONSTANTS.MAX_LOG_STRING_LENGTH));

        try {
            if (name.startsWith("mcp__")) {
                const parts = name.split('__');
                const serverId = parts[1];
                const serverConfig = this.settings.mcpServers.find(s => s.id === serverId);

                // Enforce required confirmation if configured
                if (!serverConfig || serverConfig.requireExplicitConfirmation) {
                    const originalName = this.mcpClientManager.getOriginalToolName(name) || name;
                    const confirmedDetails = await ToolConfirmationModal.open(this.app, {
                        action: "mcp",
                        content: JSON.stringify(args, null, 2),
                        path: serverConfig?.name || "Unknown Server",
                        tool: originalName
                    });

                    if (!confirmedDetails) {
                        return { error: "User cancelled MCP tool execution." };
                    }
                }
                
                return await this.mcpClientManager.executeTool(name, args, params.signal);
            }

            switch (name) {
                case AGENT_CONSTANTS.TOOLS.LIST_MCP_RESOURCES:
                    return await this.executeListMcpResources();

                case AGENT_CONSTANTS.TOOLS.READ_MCP_RESOURCE:
                    return await this.executeReadMcpResource(args);

                case AGENT_CONSTANTS.TOOLS.GOOGLE_SEARCH:
                    return await this.executeGoogleSearch(args);

                case AGENT_CONSTANTS.TOOLS.VAULT_SEARCH:
                    return await this.executeVaultSearch(args, usedFiles, modelId, params.signal);

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
                    if (this.isPathExcluded(args.folderPath as string, false)) {
                        return { error: `Permission Denied: Agent is not allowed to list excluded folder: ${String(args.folderPath)}` };
                    }
                    return { result: this.fileTools.listFolder(args.folderPath as string) };

                case AGENT_CONSTANTS.TOOLS.READ_NOTE:
                    if (this.isPathExcluded(args.path as string, true)) {
                        return { error: `Permission Denied: Agent is not allowed to read excluded note: ${String(args.path)}` };
                    }
                    return { result: await this.fileTools.readNote(args.path as string) };

                default:
                    return { error: "Tool not found." };
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to execute ${name}`, e);
            // Truncate error to 500 chars to avoid blowing out context window
            const truncated = message.length > 500 ? message.substring(0, 500) + "..." : message;
            return { error: `Failed to execute ${name}: ${truncated}` };
        }
    }

    private async executeGoogleSearch(args: Record<string, unknown>) {
        const rawQuery = args.query;
        const query = typeof rawQuery === 'string' ? rawQuery : JSON.stringify(rawQuery);
        logger.info(`Delegating search to sub-agent for: ${query}`);
        if (this.provider.supportsWebGrounding) {
            const result = await this.reasoningClient.searchWithGrounding(query);
            return { result: result.text };
        }
        return { error: "Google Search is not supported by the current provider." };
    }

    private async executeVaultSearch(args: Record<string, unknown>, usedFiles: Set<string>, modelId?: string, signal?: AbortSignal) {
        const rawQuery = args.query;
        const query = typeof rawQuery === 'string' ? rawQuery.toLowerCase() : '';

        if (!query || query.trim().length === 0) {
            return { result: "Error: Search query was empty." };
        }

        const rawLimit = this.settings?.vaultSearchResultsLimit ?? DEFAULT_SETTINGS.vaultSearchResultsLimit;
        const limit = Math.max(0, Math.trunc(rawLimit));

        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const results = await this.searchOrchestrator.search(query, limit, { deep: false, signal });
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        if (results.length === 0) {
            return { result: "No relevant notes found." };
        }

        const activeModel = modelId || this.settings.chatModel;
        const totalTokens = ModelRegistry.resolveContextBudget(activeModel, this.settings.modelContextOverrides, this.settings.contextWindowTokens);
        const contextBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

        const { context, usedFiles: resultFiles } = await this.contextAssembler.assemble(results, query, contextBudget);

        if (!context) {
            return { result: "No relevant notes found or context budget exceeded." };
        }

        resultFiles.forEach(f => usedFiles.add(normalizePath(f)));
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
        const url = args.url as string;
        if (!url) return { error: "URL argument is required." };

        if (!isExternalUrl(url, this.settings.allowLocalNetworkAccess)) {
            return { error: "Access to local network, private IP addresses, or restricted protocols is forbidden for security reasons. You can enable 'Local Network Access' in Advanced Settings if this is intended." };
        }

        const res = await requestUrl({ url });
        return { result: res.text.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) };
    }

    private async executeCalculator(args: Record<string, unknown>, isCodeEnabled: boolean) {
        if (!isCodeEnabled) return { error: "Code execution tool is disabled." };

        const task = args.task as string;
        logger.info(`Delegating to Code Sub-Agent (${this.settings.codeModel}): ${task}`);
        if (this.provider.supportsCodeExecution) {
            const result = await this.reasoningClient.solveWithCode(task);
            return { result: result.text };
        }
        return { error: "Code execution is not supported by the current provider." };
    }

    private async executeWriteOperation(name: string, args: Record<string, unknown>, createdFiles: Set<string>, isWriteEnabled: boolean) {
        if (!isWriteEnabled) {
            return { error: "Agent write access is disabled. The user must enable 'Write' in the chat view or globally in plugin settings." };
        }

        const isNote = name !== AGENT_CONSTANTS.TOOLS.CREATE_FOLDER;
        const pathsToCheck = [args.path as string, args.newPath as string].filter(p => p && p.trim().length > 0);

        const isExcluded = pathsToCheck.some(p => this.isPathExcluded(p, isNote));

        if (isExcluded) {
            return { error: `Permission Denied: Agent is not allowed to perform write or move operations involving excluded paths.` };
        }

        let action: "create" | "update" | "rename" | "folder";
        switch (name) {
            case AGENT_CONSTANTS.TOOLS.CREATE_NOTE: action = "create"; break;
            case AGENT_CONSTANTS.TOOLS.UPDATE_NOTE: action = "update"; break;
            case AGENT_CONSTANTS.TOOLS.RENAME_NOTE: action = "rename"; break;
            case AGENT_CONSTANTS.TOOLS.CREATE_FOLDER: action = "folder"; break;
            default: action = "create";
        }

        if ((action === "create" || action === "update") && (!args.content || typeof args.content !== "string" || args.content.trim() === "")) {
            return { error: "CRITICAL SYSTEM ERROR: You did not provide any text in the 'content' argument! Do NOT generate the file text in your conversation output! You MUST place the final text inside the 'content' parameter of this tool call. Please call the tool again correctly." };
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

    private isPathExcluded(rawPath: string | undefined, isNote: boolean): boolean {
        if (!rawPath || rawPath.trim().length === 0) return false;

        let processedPath = rawPath.replace(/^\/+/, "");
        if (isNote && !processedPath.toLowerCase().endsWith(".md")) {
            processedPath += ".md";
        }

        const targetPath = normalizePath(processedPath).toLowerCase();

        return this.settings.excludedFolders.some(folder => {
            const normalizedFolder = folder.toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
            return targetPath.startsWith(normalizedFolder + "/") || targetPath === normalizedFolder;
        });
    }

    private async executeListMcpResources() {
        if (!this.mcpClientManager) return { error: "MCP Client Manager is not available." };
        
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Timeout while fetching MCP resources.")), MCP_CONSTANTS.TOOL_EXECUTION_TIMEOUT_MS)
        );

        try {
            const fetchPromise = this.mcpClientManager.getAvailableResources();
            const resources = await Promise.race([fetchPromise, timeoutPromise]);
            
            if (!resources || resources.length === 0) {
                return { result: "No MCP resources available." };
            }
            
            const TRUNCATE_LIMIT = 100;
            const limitedResources = resources.slice(0, TRUNCATE_LIMIT);
            let listString = limitedResources.map((res: unknown) => {
                const r = res as { name?: string, serverId: string, uri: string };
                return `- Server: ${String(r.serverId)} | Name: ${String(r.name || r.uri)} | URI: ${String(r.uri)}`;
            }).join('\n');
            
            if (resources.length > TRUNCATE_LIMIT) {
                listString += `\n\n...and ${resources.length - TRUNCATE_LIMIT} more resources. Be specific in your queries if searching for something.`;
            }

            return { result: `Available MCP Resources:\n${listString}` };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to list MCP resources`, e);
            return { error: `Failed to list MCP resources: ${message}` };
        }
    }

    private async executeReadMcpResource(args: Record<string, unknown>) {
        if (!this.mcpClientManager) return { error: "MCP Client Manager is not available." };
        const serverId = args.serverId as string;
        const uri = args.uri as string;
        if (!serverId || !uri) return { error: "serverId and uri arguments are required." };

        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout while reading MCP resource: ${uri}`)), MCP_CONSTANTS.TOOL_EXECUTION_TIMEOUT_MS)
        );

        try {
            const fetchPromise = this.mcpClientManager.readResource(serverId, uri);
            const content = await Promise.race([fetchPromise, timeoutPromise]) as { contents?: Array<{ text?: string }> };

            if (content && content.contents && Array.isArray(content.contents)) {
                const texts = content.contents.map(c => c.text).filter((t): t is string => typeof t === 'string');
                if (texts.length > 0) {
                    const resultText = texts.join('\n\n');
                    
                    let finalResult: string;
                    try {
                        const parsed = JSON.parse(resultText) as JsonValue;
                        const smartTruncated = truncateJsonStrings(parsed, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT);
                        finalResult = JSON.stringify(smartTruncated);
                    } catch {
                        finalResult = resultText.length > SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT
                            ? resultText.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) + '... [Truncated]'
                            : resultText;
                    }
                    
                    return { result: finalResult };
                }
            }
            return { result: "Resource is empty or not text-based." };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to read MCP resource`, e);
            return { error: `Failed to read MCP resource: ${message}` };
        }
    }
}
