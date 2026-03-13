
import { App, MarkdownView, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";

import { SEARCH_CONSTANTS, REGEX_CONSTANTS } from "../constants";
import { GraphService } from "../services/GraphService";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../settings";
import { FileTools } from "../tools/FileTools";
import { ToolRegistry } from "../tools/ToolRegistry";
import { IEmbeddingClient, IToolDefinition, StreamChunk, ToolCall, ToolResult, UnifiedMessage, IReasoningClient, IModelProvider } from "../types/providers";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { ContextAssembler } from "./ContextAssembler";
import { ModelRegistry } from "./ModelRegistry";
import { ProviderRegistry } from "./ProviderRegistry";
import { SearchOrchestrator } from "./SearchOrchestrator";

export interface ChatMessage {
    contextFiles?: string[];
    createdFiles?: string[];
    rawContent?: unknown[];
    role: "user" | "model" | "system" | "tool";
    spotlightResults?: VaultSearchResult[];
    text: string;
    thought?: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
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
    private providerRegistry: ProviderRegistry;
    private settings: VaultIntelligenceSettings;

    private contextAssembler: ContextAssembler;
    private searchOrchestrator: SearchOrchestrator;
    private toolRegistry: ToolRegistry;

    constructor(
        app: App,
        providerRegistry: ProviderRegistry,
        graphService: GraphService,
        embeddingService: IEmbeddingClient,
        settings: VaultIntelligenceSettings
    ) {
        this.app = app;
        this.providerRegistry = providerRegistry;
        this.graphService = graphService;
        this.embeddingService = embeddingService;
        this.settings = settings;

        // Initialize with default providers from registry
        const initialClient = this.providerRegistry.getReasoningClient();
        const initialProvider = this.providerRegistry.getModelProvider();

        this.searchOrchestrator = new SearchOrchestrator(app, graphService, initialClient, this.embeddingService, settings);
        this.contextAssembler = new ContextAssembler(app, graphService, settings);

        const fileTools = new FileTools(app);
        this.toolRegistry = new ToolRegistry(
            app,
            settings,
            initialClient,
            initialProvider,
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
        options: { modelId?: string; enableCodeExecution?: boolean; enableAgentWriteAccess?: boolean; signal?: AbortSignal } = {}
    ): Promise<{ createdFiles: string[]; files: string[]; text: string }> {
        const stream = this.chatStream(messages, currentPrompt, contextFiles, options);
        let finalText = "";
        let finalFiles: string[] = [];
        let finalCreatedFiles: string[] = [];

        for await (const chunk of stream) {
            if (chunk.text) finalText += chunk.text;
            if (chunk.isDone) {
                finalFiles = chunk.files || [];
                finalCreatedFiles = chunk.createdFiles || [];
            }
        }
        return { createdFiles: finalCreatedFiles, files: finalFiles, text: finalText };
    }

    public async *chatStream(
        messages: ChatMessage[],
        currentPrompt: string,
        contextFiles: TFile[] = [],
        options: { modelId?: string; enableCodeExecution?: boolean; enableAgentWriteAccess?: boolean; signal?: AbortSignal } = {}
    ): AsyncIterableIterator<StreamChunk> {
        const reasoningClient: IReasoningClient = this.providerRegistry.getReasoningClient(options.modelId);
        const provider: IModelProvider = this.providerRegistry.getModelProvider(options.modelId);

        // Update ToolRegistry for this turn if model changed
        this.toolRegistry.updateProvider(reasoningClient, provider);

        const history: UnifiedMessage[] = [
            ...messages.map(h => ({
                content: h.text,
                rawContent: h.rawContent,
                role: h.role as "user" | "model" | "tool",
                toolCalls: h.toolCalls,
                toolResults: h.toolResults
            }))
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
                        const internalLeaf = leaf as unknown as InternalWorkspaceLeaf;
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

        const usedFiles = new Set<string>();
        const createdFiles = new Set<string>();
        const wereFilesExplicitlyMentioned = contextFiles.length > 0;

        const formattedHistory: UnifiedMessage[] = history.map(h => ({
            content: h.content,
            rawContent: h.rawContent,
            role: h.role,
            toolCalls: h.toolCalls,
            toolResults: h.toolResults
        }));

        if (contextFiles.length > 0) {
            const fileResults: VaultSearchResult[] = contextFiles.map(f => ({
                isKeywordMatch: true,
                path: f.path,
                score: 1.0
            }));

            const activeModel = options.modelId || this.settings.chatModel;
            const totalTokens = ModelRegistry.resolveContextBudget(activeModel, this.settings.modelContextOverrides, this.settings.contextWindowTokens);
            const contextBudget = Math.floor(totalTokens * SEARCH_CONSTANTS.CONTEXT_SAFETY_MARGIN);

            const { context, usedFiles: assembledFiles } = await this.contextAssembler.assemble(fileResults, currentPrompt, contextBudget);

            if (context) {
                if (wereFilesExplicitlyMentioned && assembledFiles.length < contextFiles.length) {
                    const skipped = contextFiles.length - assembledFiles.length;
                    currentPrompt = `[SYSTEM NOTE: ${skipped} context files were skipped because they exceeded the context window budget for the selected model.]\n\n` + currentPrompt;
                }
                currentPrompt = `The following notes were automatically injected from your workspace context:\n${context}\n\nUser Query: ${currentPrompt}`;

                // ONLY track files that actually survived the budget
                assembledFiles.forEach(f => usedFiles.add(normalizePath(f)));
            }
        }

        const currentDate = new Date().toDateString();
        const rawSystemInstruction = this.settings.systemInstruction ?? DEFAULT_SYSTEM_PROMPT;
        let systemInstruction = (rawSystemInstruction || "").replace("{{DATE}}", currentDate);
        systemInstruction = systemInstruction.replace("{{LANGUAGE}}", this.settings.agentLanguage || "English (US)");

        const tools: IToolDefinition[] = this.toolRegistry.getTools(options.enableCodeExecution);
        formattedHistory.push({ content: currentPrompt, role: "user" });

        try {
            let loops = 0;
            const maxLoops = this.settings?.maxAgentSteps ?? DEFAULT_SETTINGS.maxAgentSteps;

            while (loops < maxLoops) {
                if (options.signal?.aborted) break;

                let modelResponseRawContent: unknown[] | undefined;

                const stream = reasoningClient.generateMessageStream(formattedHistory, {
                    modelId: options.modelId,
                    signal: options.signal,
                    systemInstruction: systemInstruction,
                    tools: tools.length > 0 ? tools : undefined
                });

                let loopText = "";
                const loopToolCalls: ToolCall[] = [];

                for await (const chunk of stream) {
                    if (options.signal?.aborted) break;

                    if (chunk.toolCalls) {
                        loopToolCalls.push(...chunk.toolCalls);
                    }
                    if (chunk.text !== undefined) {
                        loopText += chunk.text;
                        yield { text: chunk.text };
                    }
                    if (chunk.rawContent) {
                        modelResponseRawContent = chunk.rawContent;
                    }
                }

                if (options.signal?.aborted) break;

                const modelResponse: UnifiedMessage = {
                    content: loopText,
                    rawContent: modelResponseRawContent,
                    role: "model",
                    toolCalls: loopToolCalls.length > 0 ? loopToolCalls : undefined
                };
                formattedHistory.push(modelResponse);

                // Yield the final model message metadata so UI can store it for follow-up turns
                yield { 
                    rawContent: modelResponseRawContent,
                    toolCalls: loopToolCalls.length > 0 ? loopToolCalls : undefined
                };

                if (loopToolCalls.length > 0) {
                    const toolStatus = `Thinking: Using tools (${loopToolCalls.map(c => c.name).join(", ")})...`;
                    yield { status: toolStatus };

                    const toolPromises = loopToolCalls.map(async (call) => {
                        const args = call.args || {};
                        const functionResponse = await this.toolRegistry.execute({
                            args: args,
                            createdFiles: createdFiles,
                            enableAgentWriteAccess: options.enableAgentWriteAccess,
                            enableCodeExecution: options.enableCodeExecution,
                            modelId: options.modelId,
                            name: call.name,
                            usedFiles: usedFiles
                        });

                        return {
                            id: call.id,
                            name: call.name,
                            result: functionResponse,
                            thought_signature: call.thought_signature
                        };
                    });

                    const completedParts = await Promise.all(toolPromises);

                    if (completedParts.length > 0) {
                        const toolMsg: UnifiedMessage = {
                            content: "",
                            role: "tool",
                            toolResults: completedParts.map(p => ({
                                id: p.id,
                                name: p.name,
                                result: p.result,
                                thought_signature: p.thought_signature
                            }))
                        };
                        formattedHistory.push(toolMsg);
                        
                        // Yield tool results to UI for history preservation
                        yield { toolResults: toolMsg.toolResults };
                    } else {
                        break;
                    }
                } else {
                    break;
                }
                loops++;
            }

            if (loops >= maxLoops) {
                yield { text: "\n\nI'm sorry, I reached the step limit before finding a definitive answer. Please try rephrasing or check your settings." };
            }

            if (!options.signal?.aborted) {
                yield {
                    createdFiles: Array.from(createdFiles),
                    files: Array.from(usedFiles),
                    isDone: true
                };
            }

        } catch (e: unknown) {
            logger.error("Error in AgentService chatStream", e);
            const errorMessage = e instanceof Error ? e.message : String(e);

            if (errorMessage.includes("400") || errorMessage.includes("API key")) {
                yield { text: `\n\nI encountered an error connecting to the AI provider (Status 400). Please check your API key.\n\nDetails: ${errorMessage}` };
            } else {
                yield { text: `\n\nSorry, I encountered an error: ${errorMessage}` };
            }
            
            yield { createdFiles: [], files: [], isDone: true };
        }
    }

    /**
     * Prepares the context for a chat message by resolving file references (`@Filename`).
     * This separates the view logic from the business logic.
     * @param inputMessage - The raw message from the user.
     * @returns Object containing resolved context files, the clean message, and any warnings.
     */
    public async prepareContext(inputMessage: string, modelId?: string): Promise<{ contextFiles: TFile[], cleanMessage: string, warnings: string[] }> {
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
                    await this.processFolderContext(abstractFile, message, allPotentialFiles, warnings, modelId);
                }
            }
        }

        resultFiles.push(...allPotentialFiles);

        return { cleanMessage: message, contextFiles: resultFiles, warnings };
    }

    private async processFolderContext(folder: TFolder, query: string, collector: TFile[], warnings: string[], modelId?: string) {
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
        const activeModel = modelId || this.settings.chatModel;
        const totalTokens = ModelRegistry.resolveContextBudget(activeModel, this.settings.modelContextOverrides, this.settings.contextWindowTokens);
        const charBudget = (totalTokens * SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE) * 0.5;
        const maxFiles = this.settings.contextMaxFiles || SEARCH_CONSTANTS.DEFAULT_CONTEXT_MAX_FILES;

        let currentSize = 0;
        const filesToInclude: TFile[] = [];

        for (const file of sortedFiles) {
            const size = file.stat.size;
            if (currentSize + size > charBudget || filesToInclude.length >= maxFiles) break;

            filesToInclude.push(file);
            currentSize += size;
        }

        if (filesToInclude.length < folderFiles.length) {
            const method = similarityResults.length > 0 ? "similarity-ranked" : "most recent";
            const limitReason = filesToInclude.length >= maxFiles ? `Max file limit (${maxFiles})` : `Context limit (~${totalTokens.toLocaleString()} tokens)`;
            warnings.push(`${limitReason} reached for folder "${folder.name}". Included ${filesToInclude.length} ${method} files.`);
        }

        filesToInclude.forEach(f => {
            if (!collector.some(existing => existing.path === f.path)) {
                collector.push(f);
            }
        });
    }
}