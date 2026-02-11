import { Part, Content } from "@google/genai";
import { TFile, TFolder, App, MarkdownView } from "obsidian";

import { SEARCH_CONSTANTS, REGEX_CONSTANTS } from "../constants";
import { GraphService } from "../services/GraphService";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../settings";
import { FileTools } from "../tools/FileTools";
import { ToolRegistry } from "../tools/ToolRegistry";
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
    spotlightResults?: VaultSearchResult[];
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
    private toolRegistry: ToolRegistry;

    constructor(
        app: App,
        gemini: GeminiService,
        graphService: GraphService,
        embeddingService: IEmbeddingService,
        settings: VaultIntelligenceSettings
    ) {
        this.app = app;
        this.gemini = gemini; // Still needed for chat/grounding/code
        this.graphService = graphService;
        this.embeddingService = embeddingService;
        this.settings = settings;

        // Initialize delegates
        this.searchOrchestrator = new SearchOrchestrator(app, graphService, gemini, embeddingService, settings);
        this.contextAssembler = new ContextAssembler(app, graphService, settings);

        const fileTools = new FileTools(app);
        this.toolRegistry = new ToolRegistry(
            app,
            settings,
            gemini,
            graphService,
            this.searchOrchestrator,
            this.contextAssembler,
            fileTools
        );
    }

    public getSearchOrchestrator(): SearchOrchestrator {
        return this.searchOrchestrator;
    }

    /**
     * DUAL-LOOP: Loop 1 (Reflex) Search.
     * Fast, local search suitable for immediate feedback (e.g. Spotlight).
     * @param query - The search query.
     * @param limit - Max results.
     * @returns Raw search results.
     */
    public async reflexSearch(query: string, limit: number): Promise<VaultSearchResult[]> {
        return this.searchOrchestrator.searchReflex(query, limit);
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
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                contextFiles.push(activeFile);
            }

            this.app.workspace.iterateRootLeaves((leaf) => {
                // Background tabs in a tab group are not 'visible' or 'active' in their leaf
                // We only want files that are actually showing to the user
                const view = leaf.view;
                if (view instanceof MarkdownView) {
                    const file = view.file;
                    if (file && (!activeFile || file.path !== activeFile.path)) {
                        // Check if this leaf is actually the active one in its container (tab group)
                        // This prevents pulling in 'hidden' tabs from the same group as the active tab
                        // @ts-ignore - internal API but common in Obsidian plugins for visibility check
                        const isVisible = leaf.parent?.type === "tabs" ? leaf.parent.activeLeaf === leaf : true;

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

        const formattedHistory = history
            .filter(h => h.role === "user" || h.role === "model")
            .map(h => ({
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
        const rawSystemInstruction = this.settings.systemInstruction ?? DEFAULT_SYSTEM_PROMPT;

        // Replace placeholders
        let systemInstruction = (rawSystemInstruction || "").replace("{{DATE}}", currentDate);
        systemInstruction = systemInstruction.replace("{{LANGUAGE}}", this.settings.agentLanguage || "English (US)");

        const tools = this.toolRegistry.getTools(options.enableCodeExecution);
        const chat = await this.gemini.startChat(formattedHistory, tools, systemInstruction, options.modelId);

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
                        const functionResponse = await this.toolRegistry.execute({
                            args: args,
                            createdFiles: createdFiles,
                            enableAgentWriteAccess: options.enableAgentWriteAccess,
                            enableCodeExecution: options.enableCodeExecution,
                            name: call.name,
                            usedFiles: usedFiles
                        });

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