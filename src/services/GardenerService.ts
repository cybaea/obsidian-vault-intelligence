import { z } from "zod";
import { GeminiService } from "./GeminiService";
import { OntologyService } from "./OntologyService";
import { App, TFile, TFolder, normalizePath } from "obsidian";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings/types";
import { GardenerStateService } from "./GardenerStateService";
import { SEARCH_CONSTANTS, GARDENER_CONSTANTS } from "../constants";

/**
 * Zod Schema for a single refactoring action.
 */
export const RefactoringActionSchema = z.object({
    filePath: z.string(),
    action: z.enum([GARDENER_CONSTANTS.ACTIONS.UPDATE_TOPICS]),
    description: z.string(),
    changes: z.object({
        field: z.string(),
        oldValue: z.unknown().optional(),
        newValue: z.unknown()
    }).array(),
    rationale: z.string()
});

/**
 * Zod Schema for the entire Gardener Plan.
 */
export const GardenerPlanSchema = z.object({
    date: z.string(),
    summary: z.string(),
    actions: RefactoringActionSchema.array(),
    newTopicDefinitions: z.array(z.object({ topicLink: z.string(), definition: z.string() })).optional(),
    loading: z.boolean().optional(),
    error: z.string().optional()
});

export type GardenerPlan = z.infer<typeof GardenerPlanSchema>;

/**
 * Service to orchestrate the vault "Tidying" process.
 */
/**
 * Service that orchestrates vault "gardening" activities.
 * Analyzes note structure and proposes metadata improvements based on the ontology.
 */
export class GardenerService {
    private app: App;
    private gemini: GeminiService;
    private ontology: OntologyService;
    private settings: VaultIntelligenceSettings;
    private state: GardenerStateService;

    constructor(app: App, gemini: GeminiService, ontology: OntologyService, settings: VaultIntelligenceSettings, state: GardenerStateService) {
        this.app = app;
        this.gemini = gemini;
        this.ontology = ontology;
        this.settings = settings;
        this.state = state;
    }

    /**
     * Runs the Gardener analysis and generates a plan note.
     * Uses a "Placeholder-to-Update" flow: creates the file immediately, opens it, then updates in background.
     */
    /**
     * Scans the vault for potential improvements and generates a "gardening plan".
     * @returns The TFile of the generated plan or null if no actions needed.
     */
    public async tidyVault(): Promise<TFile | null> {
        logger.info("Starting Gardener: Tidy Vault");

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
        void this.runAnalysis(planFile);

        return planFile;
    }

    /**
     * Performs the actual analysis in the background and updates the plan file.
     */
    private async runAnalysis(planFile: TFile): Promise<void> {
        try {
            // 1. Gather context
            const excludedPaths = [
                ...this.settings.excludedFolders.map(p => normalizePath(p)),
                normalizePath(this.settings.gardenerPlansPath)
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
            const contextBudget = this.settings.gardenerContextBudget;

            // Estimate base prompt overhead
            const basePromptEstimate = (validTopicsList.length + (ontologyContext.instructions?.length || 0) + ontologyFolders.length + 2000) / charsPerToken;
            let currentTokenEstimate = basePromptEstimate;
            const notes: TFile[] = [];

            for (const file of allFiles) {
                // Check note limit first
                if (notes.length >= this.settings.gardenerNoteLimit) break;

                // Only consider files the state says we should
                if (this.state.shouldProcess(file, this.settings.gardenerSkipRetentionDays, this.settings.gardenerRecheckHours)) {
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

            // 2b. Prepare System Instruction
            let systemInstruction = this.settings.gardenerSystemInstruction;

            // Replace placeholders
            systemInstruction = systemInstruction.replace("{{ONTOLOGY_FOLDERS}}", ontologyFolders);
            systemInstruction = systemInstruction.replace("{{NOTE_COUNT}}", String(notes.length));

            // Merge with Instructions.md if exists
            if (ontologyContext.instructions) {
                systemInstruction += `\n\n### ADDITIONAL USER INSTRUCTIONS:\n${ontologyContext.instructions}`;
            }

            // 3. Generate structured plan
            const prompt = `
VALID TOPICS:
(Note: Multiple names may point to the same file path; these are aliases for the same concept.)
${validTopicsList}

Analyze the following notes and suggest improvements.

NOTES:
${JSON.stringify(context, null, 2)}
`.trim();

            const jsonPlan = await this.gemini.generateStructuredContent(prompt, {
                type: "object",
                properties: {
                    date: { type: "string" },
                    summary: { type: "string" },
                    actions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                filePath: { type: "string" },
                                action: { type: "string", enum: [GARDENER_CONSTANTS.ACTIONS.UPDATE_TOPICS] },
                                description: { type: "string" },
                                changes: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            field: { type: "string" },
                                            newValue: {
                                                oneOf: [
                                                    { type: "string" },
                                                    { type: "array", items: { type: "string" } }
                                                ]
                                            }
                                        },
                                        required: ["field", "newValue"]
                                    }
                                },
                                rationale: { type: "string" }
                            },
                            required: ["filePath", "action", "description", "changes", "rationale"]
                        }
                    },
                    newTopicDefinitions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                topicLink: { type: "string" },
                                definition: { type: "string" }
                            },
                            required: ["topicLink", "definition"]
                        }
                    }
                },
                required: ["date", "summary", "actions"]
            }, {
                model: this.settings.gardenerModel,
                systemInstruction: systemInstruction
            });

            const parsedPlan = GardenerPlanSchema.parse(JSON.parse(jsonPlan));

            // Post-process links to ensure URL encoding if AI missed it
            if (parsedPlan.actions) {
                for (const action of parsedPlan.actions) {
                    for (const change of action.changes) {
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
            const content = `
# ${GARDENER_CONSTANTS.PLAN_PREFIX} - ${parsedPlan.date}

${parsedPlan.summary}

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
                date: new Date().toISOString().split('T')[0],
                summary: "Gardener analysis failed.",
                actions: [],
                error: error instanceof Error ? error.message : String(error)
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
