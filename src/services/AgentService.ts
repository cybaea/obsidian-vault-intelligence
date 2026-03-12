
import { TFile, TFolder, App, MarkdownView, WorkspaceLeaf } from "obsidian";

import { SEARCH_CONSTANTS, REGEX_CONSTANTS } from "../constants";
import { GraphService } from "../services/GraphService";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../settings";
import { FileTools } from "../tools/FileTools";
import { ToolRegistry } from "../tools/ToolRegistry";
import { IEmbeddingClient, IModelProvider, IReasoningClient, UnifiedMessage } from "../types/providers";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { ContextAssembler } from "./ContextAssembler";
import { SearchOrchestrator } from "./SearchOrchestrator";

export interface ChatMessage {
    contextFiles?: string[];
    createdFiles?: string[];
    role: "user" | "model" | "system";
    spotlightResults?: VaultSearchResult[];
    text: string;
    thought?: string;
}

// Internal interface for accessing non-public Obsidian API properties
interface InternalWorkspaceLeaf {
    parent?: {
        activeLeaf?: WorkspaceLeaf;
        type: string;
    };
}

/**
 * Service responsible for orchestrating the AI agent activities.
 * It manages tool execution, chat history, and context assembly.
 */
export class AgentService {
    private app: App;
    private embeddingService: IEmbeddingClient;
    private graphService: GraphService;
    private reasoningClient: IReasoningClient;
    private settings: VaultIntelligenceSettings;

    private contextAssembler: ContextAssembler;
    private searchOrchestrator: SearchOrchestrator;
    private toolRegistry: ToolRegistry;

    constructor(
        app: App,
        reasoningClient: IReasoningClient,
        provider: IModelProvider,
        graphService: GraphService,
        embeddingService: IEmbeddingClient,
        settings: VaultIntelligenceSettings
    ) {
        this.app = app;
        this.reasoningClient = reasoningClient;
        this.graphService = graphService;
        this.embeddingService = embeddingService;
        this.settings = settings;

        this.searchOrchestrator = new SearchOrchestrator(app, graphService, this.reasoningClient, this.embeddingService, settings);
        this.contextAssembler = new ContextAssembler(app, graphService, settings);

        const fileTools = new FileTools(app);
        this.toolRegistry = new ToolRegistry(
            app,
            settings,
            this.reasoningClient,
            provider,
            graphService,
            this.searchOrchestrator,
            this.contextAssembler,
            fileTools
        );
    }

    public getSearchOrchestrator(): SearchOrchestrator {
        return this.searchOrchestrator;
    }

    public async reflexSearch(query: string, limit: number): Promise<VaultSearchResult[]> {
        return this.searchOrchestrator.searchReflex(query, limit);
    }

    public async chat(
        messages: ChatMessage[],
        currentPrompt: string,
        contextFiles: TFile[] = [],
        options: { modelId?: string; enableCodeExecution?: boolean; enableAgentWriteAccess?: boolean } = {}
    ): Promise<{ createdFiles: string[]; files: string[]; text: string }> {
        const history: UnifiedMessage[] = [
            ...messages.filter(h => h.role === "user" || h.role === "model").map(h => ({
                content: h.text,
                role: h.role as "user" | "model"
            })),
            { content: currentPrompt, role: 'user' }
        ];

        if (contextFiles.length === 0) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                contextFiles.push(activeFile);
            }

            this.app.workspace.iterateRootLeaves((leaf) => {
                const view = leaf.view;
                if (view instanceof MarkdownView) {
                    const file = view.file;
                    if (file && (!activeFile || file.path !== activeFile.path)) {
                        // FIX: Double cast to bypass strict overlap check
                        const internalLeaf = leaf as unknown as InternalWorkspaceLeaf;

                        // Check if this leaf is actually the active one in its container (tab group)
                        const isVisible = internalLeaf.parent?.type === "tabs" ? internalLeaf.parent.activeLeaf === leaf : true;

                        if (isVisible && !contextFiles.some(f => f.path === file.path)) {
                            contextFiles.push(file);
                        }
                    }
                }
            });

            if (contextFiles.length > 0) {
                logger.info(`[Agent] Auto-injected ${contextFiles.length} visible files (Active: ${activeFile?.path ?? "None"}).`);
            }
        }

        // Initialize files trackers
        const usedFiles = new Set<string>();
        const createdFiles = new Set<string>();
        contextFiles.forEach(f => usedFiles.add(f.path));

        const formattedHistory: UnifiedMessage[] = history
            .filter(h => h.role === "user" || h.role === "model")
            .map(h => ({
                content: h.content,
                role: h.role as "user" | "model"
            }));

        if (contextFiles.length > 0) {
            // Map files to VaultSearchResult format for assembler
            const fileResults: VaultSearchResult[] = contextFiles.map(f => ({
                isKeywordMatch: true,
                path: f.path,
                score: 1.0
            }));

            // Assemble intelligently respecting budget
            const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
            const contextBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

            const { context } = await this.contextAssembler.assemble(fileResults, currentPrompt, contextBudget);

            if (context) {
                currentPrompt = `The following notes were automatically injected from your workspace context:\n${context}\n\nUser Query: ${currentPrompt}`;
            }
        }

        const currentDate = new Date().toDateString();
        const rawSystemInstruction = this.settings.systemInstruction ?? DEFAULT_SYSTEM_PROMPT;

        // Replace placeholders
        let systemInstruction = (rawSystemInstruction || "").replace("{{DATE}}", currentDate);
        systemInstruction = systemInstruction.replace("{{LANGUAGE}}", this.settings.agentLanguage || "English (US)");

        const tools = this.toolRegistry.getTools(options.enableCodeExecution);
        formattedHistory.push({ content: currentPrompt, role: "user" });

        try {
            let loops = 0;
            const maxLoops = this.settings?.maxAgentSteps ?? DEFAULT_SETTINGS.maxAgentSteps;
            let currentMessage = ""; 

            while (loops < maxLoops) {
                const result = await this.reasoningClient.generateMessage(formattedHistory, {
                    modelId: options.modelId,
                    systemInstruction: systemInstruction,
                    tools: tools.length > 0 ? tools : undefined
                });
                
                // Keep history updated with the model's response
                formattedHistory.push(result);

                const calls = result.toolCalls;

                if (calls && calls.length > 0) {
                    const toolPromises = calls.map(async (call) => {
                        const args = call.args || {};
                        const functionResponse = await this.toolRegistry.execute({
                            args: args,
                            createdFiles: createdFiles,
                            enableAgentWriteAccess: options.enableAgentWriteAccess,
                            enableCodeExecution: options.enableCodeExecution,
                            name: call.name,
                            usedFiles: usedFiles
                        });

                        return {
                            id: call.id,
                            name: call.name,
                            response: functionResponse
                        };
                    });

                    const completedParts = await Promise.all(toolPromises);

                    if (completedParts.length > 0) {
                        // Serialize structured tool results into the history
                        // GeminiProvider (and standard tool-capable models) expect one response per call
                        const toolResponses = completedParts.map(p => ({
                            content: "",
                            name: p.name,
                            role: "user" as const,
                            // Carrying the response object in toolCalls[0].args for GeminiProvider adapter compat
                            toolCalls: [{
                                args: p.response,
                                id: p.id,
                                name: p.name
                            }]
                        }));
                        formattedHistory.push(...toolResponses);
                    } else {
                        currentMessage = result.content || "";
                        break;
                    }
                } else {
                    currentMessage = result.content || "";
                    break;
                }
                loops++;
            }

            // Did we hit the cap with unresolved tools?
            // Did we hit the cap with unresolved tools?
            if (loops >= maxLoops && !currentMessage) {
                logger.warn("Agent hit max steps limit with pending tool calls.");
                return {
                    createdFiles: Array.from(createdFiles),
                    files: Array.from(usedFiles),
                    text: "I'm sorry, I searched through your notes but couldn't find a definitive answer within the step limit. You might try rephrasing your query or increasing the 'Max agent steps' setting."
                };
            }

            return { createdFiles: Array.from(createdFiles), files: Array.from(usedFiles), text: currentMessage };

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

    /**
     * Prepares the context for a chat message by resolving file references (`@Filename`).
     * This separates the view logic from the business logic.
     * @param inputMessage - The raw message from the user.
     * @returns Object containing resolved context files, the clean message, and any warnings.
     */
    public async prepareContext(inputMessage: string): Promise<{ contextFiles: TFile[], cleanMessage: string, warnings: string[] }> {
        const resultFiles: TFile[] = [];
        const warnings: string[] = [];
        let message = inputMessage;

        // Regex for @[["Filename"]] or @[[Filename|Alias]] or @Filename 
        // Updated regex to be more lenient with characters and handle quoted strings better
        const mentionRegex = REGEX_CONSTANTS.MENTION;
        const matches = Array.from(inputMessage.matchAll(mentionRegex));

        // We will collect all potential files
        const allPotentialFiles: TFile[] = [];

        // We don't remove the mentions from the message, as the model might need them to understand "Look at @File"
        // But we could optionally clean them. ResearchChatView didn't clean them, so we won't either.

        for (const match of matches) {
            const pathOrName = match[1] || match[2];
            if (pathOrName) {
                // First try direct path
                let abstractFile = this.app.vault.getAbstractFileByPath(pathOrName);

                // If not found, try resolving as a link (for files)
                if (!abstractFile) {
                    abstractFile = this.app.metadataCache.getFirstLinkpathDest(pathOrName, "");
                }

                if (abstractFile instanceof TFile) {
                    if (!allPotentialFiles.some(f => f.path === abstractFile.path)) {
                        allPotentialFiles.push(abstractFile);
                    }
                } else if (abstractFile instanceof TFolder) {
                    // Expand folder into files recursively
                    await this.processFolderContext(abstractFile, message, allPotentialFiles, warnings);
                }
            }
        }

        resultFiles.push(...allPotentialFiles);

        return { cleanMessage: message, contextFiles: resultFiles, warnings };
    }

    private async processFolderContext(folder: TFolder, query: string, collector: TFile[], warnings: string[]) {
        // TFolder is a type from 'obsidian', assuming it's imported at the top of the file.

        const folderPath = folder.path;
        const folderFiles = this.app.vault.getMarkdownFiles().filter(f =>
            f.path.startsWith(folderPath + "/") || f.path === folderPath
        );

        // Try similarity search within the folder first
        const folderPaths = folderFiles.map(f => f.path);
        const similarityResults = await this.graphService.searchInPaths(query, folderPaths, 100);

        let sortedFiles: TFile[];
        if (similarityResults.length > 0) {
            const resultPathMap = new Map(similarityResults.map((r, i) => [r.path, i]));
            const matchedFiles = folderFiles.filter(f => resultPathMap.has(f.path));
            matchedFiles.sort((a, b) => (resultPathMap.get(a.path) ?? 0) - (resultPathMap.get(b.path) ?? 0));

            // Include unmatched files (not indexed yet) by recency at the end
            const unmatchedFiles = folderFiles.filter(f => !resultPathMap.has(f.path));
            unmatchedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

            sortedFiles = [...matchedFiles, ...unmatchedFiles];
        } else {
            // Fallback to recency if no similarity results (e.g. index not ready)
            sortedFiles = [...folderFiles];
            sortedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
        }

        // Calculate budget
        // We allocate 50% of the total context window for explicit folder mentions to leave room for history/responses
        const totalTokens = this.settings.contextWindowTokens || DEFAULT_SETTINGS.contextWindowTokens;
        const charBudget = (totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE) * 0.5;

        let currentSize = 0;
        const filesToInclude: TFile[] = [];

        for (const file of sortedFiles) {
            const size = file.stat.size;
            if (currentSize + size > charBudget) break;

            filesToInclude.push(file);
            currentSize += size;
        }

        if (filesToInclude.length < folderFiles.length) {
            const method = similarityResults.length > 0 ? "similarity-ranked" : "most recent";
            warnings.push(`Context limit reached for folder "${folder.name}". Included ${filesToInclude.length} ${method} files.`);
        }

        filesToInclude.forEach(f => {
            if (!collector.some(existing => existing.path === f.path)) {
                collector.push(f);
            }
        });
    }
}