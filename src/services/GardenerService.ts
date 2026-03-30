import { App, TFile, TFolder, normalizePath } from "obsidian";
import { z } from "zod";

import { SEARCH_CONSTANTS, GARDENER_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings, DEFAULT_GARDENER_SYSTEM_PROMPT } from "../settings/types";
import { IReasoningClient } from "../types/providers";
import { logger } from "../utils/logger";
import { GardenerStateService } from "./GardenerStateService";
import { GraphService } from "./GraphService";
import { ModelRegistry } from "./ModelRegistry";
import { OntologyService } from "./OntologyService";
import { ProviderRegistry } from "./ProviderRegistry";

export const GardenerActionType = z.enum([
    GARDENER_CONSTANTS.ACTIONS.UPDATE_TOPICS,
    "merge_topics",
    "archive_topic"
]);

export const MergeTopicsActionSchema = z.object({
    action: z.literal("merge_topics"),
    changes: z.object({
        field: z.string(),
        newValue: z.unknown(),
        oldValue: z.unknown().optional()
    }).array().optional(),
    description: z.string(),
    filePath: z.string(),
    rationale: z.string(),
    sourceTopic: z.string().optional(), // The one to delete
    targetTopic: z.string().optional() // The survivor
});

/**
 * Zod Schema for a single refactoring action.
 */
export const RefactoringActionSchema = z.object({
    action: z.literal(GARDENER_CONSTANTS.ACTIONS.UPDATE_TOPICS),
    changes: z.object({
        field: z.string(),
        newValue: z.unknown(),
        oldValue: z.unknown().optional()
    }).array(),
    description: z.string(),
    filePath: z.string(),
    rationale: z.string()
});

export const ArchiveTopicActionSchema = z.object({
    action: z.literal("archive_topic"),
    changes: z.object({
        field: z.string(),
        newValue: z.unknown(),
        oldValue: z.unknown().optional()
    }).array().optional(),
    description: z.string(),
    filePath: z.string(),
    rationale: z.string()
});

export const AnyGardenerActionSchema = z.discriminatedUnion("action", [
    RefactoringActionSchema,
    MergeTopicsActionSchema,
    ArchiveTopicActionSchema
]);

/**
 * Zod Schema for the entire Gardener Plan.
 */
export const GardenerPlanSchema = z.object({
    actions: AnyGardenerActionSchema.array(),
    date: z.string(),
    error: z.string().optional(),
    loading: z.boolean().optional(),
    newTopicDefinitions: z.array(z.object({ definition: z.string(), topicLink: z.string() })).optional(),
    summary: z.string()
});

export type GardenerPlan = z.infer<typeof GardenerPlanSchema>;

export function isFileWellManaged(
    frontmatter: Record<string, unknown> | undefined,
    topicKeys: readonly string[],
    validateTopic: (topic: string) => boolean
): boolean {
    if (!frontmatter) return false;

    let topicsValue: unknown = undefined;
    for (const key of topicKeys) {
        if (frontmatter[key] !== undefined && frontmatter[key] !== null && frontmatter[key] !== "") {
            topicsValue = frontmatter[key];
            break;
        }
    }

    if (topicsValue === undefined) return false;

    const topicArray = Array.isArray(topicsValue) ? topicsValue : [topicsValue];
    if (topicArray.length === 0) return false;

    for (const topic of topicArray) {
        if (!validateTopic(String(topic))) {
            return false;
        }
    }

    return true;
}

/**
 * Service to orchestrate the vault "Tidying" process.
 */
/**
 * Service that orchestrates vault "gardening" activities.
 * Analyzes note structure and proposes metadata improvements based on the ontology.
 */
export class GardenerService {
    private app: App;
    private providerRegistry: ProviderRegistry;
    private ontology: OntologyService;
    private settings: VaultIntelligenceSettings;
    private state: GardenerStateService;
    private graphService: GraphService;

    constructor(app: App, providerRegistry: ProviderRegistry, ontology: OntologyService, settings: VaultIntelligenceSettings, state: GardenerStateService, graphService: GraphService) {
        this.app = app;
        this.providerRegistry = providerRegistry;
        this.ontology = ontology;
        this.settings = settings;
        this.state = state;
        this.graphService = graphService;
    }

    private hasTruthyGardenerIgnore(file: TFile | null): boolean {
        if (!file) return false;
        const cache = this.app.metadataCache.getFileCache(file);
        const ignoreVal = cache?.frontmatter?.['gardener-ignore'] as unknown;
        return ignoreVal === true || ignoreVal === "true" || ignoreVal === "yes" || ignoreVal === 1;
    }

    /**
     * Runs the Gardener analysis and generates a plan note.
     * Uses a "Placeholder-to-Update" flow: creates the file immediately, opens it, then updates in background.
     */
    /**
     * Scans the vault for potential improvements and generates a "gardening plan".
     * @returns The TFile of the generated plan or null if no actions needed.
     */
    public async tidyVault(strictOptimization: boolean = false): Promise<TFile | null> {
        logger.info(`Starting Gardener: Tidy Vault (Strict: ${strictOptimization})`);

        // 0. Purge old plans
        await this.purgeOldPlans();

        // 1. Create Placeholder File
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const fileName = `${GARDENER_CONSTANTS.PLAN_PREFIX} ${dateStr}.md`;
        const plansPath = normalizePath(this.settings.gardenerPlansPath);

        // Ensure plans folder exists
        if (plansPath && !(this.app.vault.getAbstractFileByPath(plansPath) instanceof TFolder)) {
            await this.app.vault.createFolder(plansPath);
        }

        const fullPath = plansPath ? `${plansPath}/${fileName}` : fileName;

        const placeholderContent = `
# ${GARDENER_CONSTANTS.PLAN_PREFIX} - ${dateStr}

Thinking... Gardening takes time. Please wait while I analyze your vault.

\`\`\`gardener-plan
{
  "loading": true,
  "date": "${dateStr}",
  "summary": "Analyzing vault hygiene...",
  "actions": []
}
\`\`\`
`.trim();

        const planFile = await this.app.vault.create(fullPath, placeholderContent);

        // Background Analysis
        void this.runAnalysis(planFile, strictOptimization);

        return planFile;
    }

    /**
     * Performs the actual analysis in the background and updates the plan file.
     */
    private async runAnalysis(planFile: TFile, strictOptimization: boolean): Promise<void> {
        try {
            // 1. Gather context
            const excludedPaths = [
                ...this.settings.excludedFolders.map(p => normalizePath(p)),
                normalizePath(this.settings.gardenerPlansPath),
                normalizePath(this.settings.ontologyPath)
            ];

            const allFiles = this.app.vault.getMarkdownFiles()
                .filter(f => !excludedPaths.some(excluded => f.path.startsWith(excluded)))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            const validTopics = await this.ontology.getValidTopics();
            const validTopicsList = validTopics.map(t => `- [${t.name}](/${t.path})`).join("\n");
            const ontologyContext = await this.ontology.getOntologyContext();
            const ontologyFolders = Object.entries(ontologyContext.folders)
                .map(([name, desc]) => `- **${name}**: ${desc}`)
                .join("\n");

            // 2. Token Estimation & Budgeting
            const charsPerToken = SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE;
            const contextBudget = ModelRegistry.resolveContextBudget(this.settings.gardenerModel, this.settings.modelContextOverrides, this.settings.gardenerContextBudget);

            // Estimate base prompt overhead
            const basePromptEstimate = (validTopicsList.length + (ontologyContext.instructions?.length || 0) + ontologyFolders.length + 2000) / charsPerToken;
            let currentTokenEstimate = basePromptEstimate;
            const notes: TFile[] = [];
            const skippedPaths: string[] = [];
            let savedTokens = 0;
            let savedFiles = 0;

            for (const file of allFiles) {
                // Check note limit first
                if (notes.length >= this.settings.gardenerNoteLimit) break;

                // Only consider files the state says we should
                if (this.state.shouldProcess(file, this.settings.gardenerSkipRetentionDays, this.settings.gardenerRecheckDays)) {
                    if (strictOptimization) {
                        const cache = this.app.metadataCache.getFileCache(file);
                        const isWellManaged = isFileWellManaged(
                            cache?.frontmatter,
                            ['topics', 'topic'],
                            (topic: string) => this.ontology.validateTopic(topic)
                        );

                        if (isWellManaged) {
                            savedTokens += file.stat.size / charsPerToken;
                            savedFiles++;
                            skippedPaths.push(file.path);
                            continue;
                        }
                    }

                    // Estimate this file's contribution
                    const fileContent = await this.app.vault.cachedRead(file);
                    const fileEstimate = fileContent.length / charsPerToken;

                    if (currentTokenEstimate + fileEstimate > contextBudget) {
                        if (notes.length === 0) {
                            // If even the first file is too big, skip it but maybe log it?
                            logger.warn(`Gardener: Note ${file.path} is too large for the context budget. Skipping.`);
                            continue;
                        }
                        logger.info(`Gardener: Reached context budget (${Math.round(currentTokenEstimate)} tokens). Stopping at ${notes.length} notes.`);
                        break;
                    }

                    notes.push(file);
                    currentTokenEstimate += fileEstimate;
                }
            }

            const context = notes.map(f => ({
                path: f.path,
                topics: (this.app.metadataCache.getFileCache(f)?.frontmatter?.["topics"] as string[]) || []
            }));

            logger.info(`Gardener: analyzing ${context.length} notes. Estimated tokens: ${Math.round(currentTokenEstimate)} / ${contextBudget}.`);

            if (skippedPaths.length > 0) {
                await this.state.recordCheckBatch(skippedPaths);
                logger.info(`Gardener: Pre-filtered (skipped) ${skippedPaths.length} notes to save tokens.`);
            }

            // 2b. Prepare System Instruction
            let systemInstruction = this.settings.gardenerSystemInstruction ?? DEFAULT_GARDENER_SYSTEM_PROMPT;

            // Replace placeholders
            systemInstruction = systemInstruction.replace("{{ONTOLOGY_FOLDERS}}", ontologyFolders);
            // Legacy support: Replace {{NOTE_COUNT}} with a static string to ensure prefix caching is not defeated
            systemInstruction = systemInstruction.replace("{{NOTE_COUNT}}", "the");
            systemInstruction = systemInstruction.replace("{{LANGUAGE}}", this.settings.agentLanguage || "English (US)");

            // Merge with Instructions.md if exists
            if (ontologyContext.instructions) {
                systemInstruction += `\n\n### ADDITIONAL USER INSTRUCTIONS:\n${ontologyContext.instructions}`;
            }

            const rawSynonyms = await this.graphService.getOntologySynonyms(this.settings.gardenerSemanticMergeThreshold || 0.85);
            const synonyms = rawSynonyms.filter(s => {
                const fileA = this.app.vault.getAbstractFileByPath(s.topicA);
                const fileB = this.app.vault.getAbstractFileByPath(s.topicB);
                return !this.hasTruthyGardenerIgnore(fileA instanceof TFile ? fileA : null) && 
                       !this.hasTruthyGardenerIgnore(fileB instanceof TFile ? fileB : null);
            });

            let synonymPromptExt = "";
            if (synonyms.length > 0) {
                synonymPromptExt = `\nSUSPECT SYNONYMS:\nIdentify if these semantic matches should be merged into a single topic. Use 'merge_topics' action if you agree.\n${JSON.stringify(synonyms, null, 2)}\n`;
            }

            // 3. Generate structured plan
            const prompt = `
VALID TOPICS:
(Note: Multiple names may point to the same file path; these are aliases for the same concept.)
${validTopicsList}
${synonymPromptExt}
Analyze the following ${notes.length} notes and suggest improvements.

NOTES:
${JSON.stringify(context, null, 2)}
`.trim();

            const gracePeriodMs = (this.settings.gardenerOrphanGracePeriodDays || 7) * 24 * 60 * 60 * 1000;
            const rawOrphans = await this.graphService.getOrphanCandidates(normalizePath(this.settings.ontologyPath), gracePeriodMs);
            const orphanCandidates = rawOrphans.filter(o => {
                const file = this.app.vault.getAbstractFileByPath(o);
                if (!(file instanceof TFile) || this.hasTruthyGardenerIgnore(file)) return false;
                return this.state.shouldProcess(file, this.settings.gardenerSkipRetentionDays, this.settings.gardenerRecheckDays);
            });

            const reasoningClient: IReasoningClient = this.providerRegistry.getReasoningClient(this.settings.gardenerModel);
            const parsedPlan = await reasoningClient.generateStructured(
                [{ content: prompt, role: "user" }],
                GardenerPlanSchema,
                {
                    contextWindowTokens: contextBudget,
                    jsonSchema: {
                        properties: {
                            actions: {
                                items: {
                                    properties: {
                                        action: { enum: [GARDENER_CONSTANTS.ACTIONS.UPDATE_TOPICS, "merge_topics", "archive_topic"], type: "string" },
                                        changes: {
                                            items: {
                                                properties: {
                                                    field: { type: "string" },
                                                    newValue: { 
                                                        items: { type: "string" },
                                                        type: "array" 
                                                    },
                                                    oldValue: { 
                                                        items: { type: "string" },
                                                        type: "array" 
                                                    }
                                                },
                                                required: ["field", "newValue"],
                                                type: "object"
                                            },
                                            type: "array"
                                        },
                                        description: { type: "string" },
                                        filePath: { type: "string" },
                                        rationale: { type: "string" },
                                        sourceTopic: { type: "string" },
                                        targetTopic: { type: "string" }
                                    },
                                    required: ["action", "description", "filePath", "rationale"],
                                    type: "object"
                                },
                                type: "array"
                            },
                            date: { type: "string" },
                            newTopicDefinitions: {
                                items: {
                                    properties: {
                                        definition: { type: "string" },
                                        topicLink: { type: "string" }
                                    },
                                    required: ["definition", "topicLink"],
                                    type: "object"
                                },
                                type: "array"
                            },
                            summary: { type: "string" }
                        },
                        required: ["actions", "date", "summary"],
                        type: "object"
                    },
                    modelId: this.settings.gardenerModel,
                    systemInstruction: systemInstruction
                }
            );

            // Inject archive_topic actions directly from DB to save tokens
            if (orphanCandidates.length > 0) {
                if (!parsedPlan.actions) parsedPlan.actions = [];
                for (const orphanPath of orphanCandidates) {
                    parsedPlan.actions.push({
                        action: "archive_topic",
                        description: `Archive unused topic: ${orphanPath.split('/').pop()?.replace('.md', '') || orphanPath}`,
                        filePath: orphanPath,
                        rationale: "This topic has no inbound links and has not been modified recently. Archiving it will reduce vault clutter."
                    });
                }
            }

            // Post-process links to ensure URL encoding if AI missed it
            if (parsedPlan.actions) {
                for (const action of parsedPlan.actions) {
                    for (const change of action.changes || []) {
                        if (change.field === "topics") {
                            if (Array.isArray(change.newValue)) {
                                change.newValue = change.newValue.map((val: unknown) => this.ensureUrlEncodedLink(String(val)));
                            } else if (typeof change.newValue === "string") {
                                change.newValue = this.ensureUrlEncodedLink(change.newValue);
                            }
                        }
                    }
                }
            }

            // Post-process newTopicDefinitions keys to match encoded links
            if (parsedPlan.newTopicDefinitions) {
                for (const def of parsedPlan.newTopicDefinitions) {
                    def.topicLink = this.ensureUrlEncodedLink(def.topicLink);
                }
            }

            // 4. Update the Plan Note
            let finalSummary = parsedPlan.summary;
            if (savedFiles > 0) {
                finalSummary += `\n\n**Cost Optimizer**: Skipped ${savedFiles} well-managed files, saving an estimated ${Math.round(savedTokens)} context tokens.`;
            }

            const content = `
# ${GARDENER_CONSTANTS.PLAN_PREFIX} - ${parsedPlan.date}

${finalSummary}

\`\`\`gardener-plan
${JSON.stringify(parsedPlan, null, 2)}
\`\`\`
`.trim();

            await this.app.vault.modify(planFile, content);
            logger.info(`Gardener Plan updated: ${planFile.path}`);

            // Record check for all files in this analysis (only after success)
            for (const note of notes) {
                await this.state.recordCheck(note.path);
            }

        } catch (error) {
            const errorObj = {
                actions: [],
                date: new Date().toISOString().split('T')[0],
                error: error instanceof Error ? error.message : String(error),
                summary: "Gardener analysis failed."
            };

            const errorContent = `
# ${GARDENER_CONSTANTS.PLAN_PREFIX} - Failed

I encountered an error during analysis.

\`\`\`gardener-plan
${JSON.stringify(errorObj, null, 2)}
\`\`\`
`.trim();
            await this.app.vault.modify(planFile, errorContent);
        }
    }

    /**
     * Purges old gardener plans based on retention settings.
     */
    public async purgeOldPlans(): Promise<void> {
        const plansPath = normalizePath(this.settings.gardenerPlansPath);
        const folder = this.app.vault.getAbstractFileByPath(plansPath);
        if (!(folder instanceof TFolder)) return;

        const now = Date.now();
        const retentionDays = this.settings.plansRetentionDays;
        if (retentionDays === 0) return; // Keep forever if 0? Or maybe 0 means purge all?
        // Let's say 0 is a special case (keep forever), or we just use a high number.
        // If user wants to purge all, they can run manual command or set to 1 day.

        const threshold = now - (retentionDays * 24 * 60 * 60 * 1000);

        for (const child of folder.children) {
            if (child instanceof TFile && child.name.startsWith(GARDENER_CONSTANTS.PLAN_PREFIX)) {
                if (child.stat.ctime < threshold) {
                    await this.app.fileManager.trashFile(child);
                    logger.info(`Purged old gardener plan (to trash): ${child.path}`);
                }
            }
        }
    }

    /**
     * Ensures a Markdown link's path is URL encoded and strips any accidental double brackets.
     * Also ensures the path starts with the ontology root if it seems to have been stripped.
     */
    private ensureUrlEncodedLink(link: string): string {
        // Match [Name](/Path) - handles cases where AI might put brackets in the name too
        const match = link.match(/\[+([^\]]+)\]+\(\/?([^)]+)\)/);
        if (!match) return link;

        let name = match[1]?.replace(/[[\]]/g, "").trim();
        let path = match[2]?.trim();

        if (!name || !path) return link;

        // Strip leading slash for processing, then add it back
        let processedPath = path.startsWith("/") ? path.slice(1) : path;

        // Ensure path starts with ontology root if it was stripped (e.g. AI returned Concepts/Topic.md instead of Ontology/Concepts/Topic.md)
        const ontologyRoot = normalizePath(this.settings.ontologyPath);
        if (ontologyRoot && !processedPath.startsWith(ontologyRoot)) {
            // Check if it's a known subfolder name that should be inside the ontology root
            processedPath = normalizePath(`${ontologyRoot}/${processedPath}`);
        }

        const decodedPath = decodeURIComponent(processedPath);
        const encodedPath = decodedPath.split('/').map(segment => encodeURIComponent(segment)).join('/');

        return `[${name}](/${encodedPath})`;
    }
}
