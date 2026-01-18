import { z } from "zod";
import { GeminiService } from "./GeminiService";
import { OntologyService } from "./OntologyService";
import { App, TFile, TFolder, normalizePath } from "obsidian";
import { logger } from "../utils/logger";
import { VaultIntelligenceSettings } from "../settings/types";

/**
 * Zod Schema for a single refactoring action.
 */
export const RefactoringActionSchema = z.object({
    filePath: z.string(),
    action: z.enum(["update_topics", "update_tags", "update_metadata", "rename_file"]),
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
export class GardenerService {
    private app: App;
    private gemini: GeminiService;
    private ontology: OntologyService;
    private settings: VaultIntelligenceSettings;

    constructor(app: App, gemini: GeminiService, ontology: OntologyService, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.gemini = gemini;
        this.ontology = ontology;
        this.settings = settings;
    }

    /**
     * Runs the Gardener analysis and generates a plan note.
     * Uses a "Placeholder-to-Update" flow: creates the file immediately, opens it, then updates in background.
     */
    public async tidyVault(): Promise<TFile | null> {
        logger.info("Starting Gardener: Tidy Vault");

        // 0. Purge old plans
        await this.purgeOldPlans();

        // 1. Create Placeholder File
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const fileName = `Gardener Plan ${dateStr}.md`;
        const plansPath = normalizePath(this.settings.gardenerPlansPath);

        // Ensure plans folder exists
        if (plansPath && !(this.app.vault.getAbstractFileByPath(plansPath) instanceof TFolder)) {
            await this.app.vault.createFolder(plansPath);
        }

        const fullPath = plansPath ? `${plansPath}/${fileName}` : fileName;

        const placeholderContent = `
# Gardener Plan - ${dateStr}

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

            const notes = this.app.vault.getMarkdownFiles()
                .filter(f => !excludedPaths.some(excluded => f.path.startsWith(excluded)))
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 50);

            const context = notes.map(f => ({
                path: f.path,
                topics: (this.app.metadataCache.getFileCache(f)?.frontmatter?.["topics"] as string[]) || [],
                tags: (this.app.metadataCache.getFileCache(f)?.frontmatter?.["tags"] as string[]) || []
            }));

            const validTopics = await this.ontology.getValidTopics();
            const ontologyContext = await this.ontology.getOntologyContext();

            // 2. Build prompt
            let customInstructions = "";
            if (ontologyContext.instructions) {
                customInstructions = `
### CUSTOM USER INSTRUCTIONS:
${ontologyContext.instructions}
                `.trim();
            }

            const ontologyFolders = Object.entries(ontologyContext.folders)
                .map(([name, desc]) => `- **${name}**: ${desc}`)
                .join("\n");

            const prompt = `
You are a Gardener for an Obsidian vault. Your goal is to suggest hygiene improvements for the vault's fluid ontology (represented by the 'topics' frontmatter field).

${customInstructions}

## YOUR ROLE:
1.  **LINKING**: Identify notes missing relevant topics and suggest adding Markdown links to existing files in the 'VALID TOPICS' list below.
2.  **PROPOSING**: If you identify a recurring theme or concept that doesn't have a topic file yet, suggest a NEW topic as a Markdown link.
    - NEW topics should be placed in one of the following folders if they fit, or you can suggest a path:
${ontologyFolders}

## CONSTRAINTS:
- Suggestions for 'topics' MUST be standard Markdown links: [Name](/Path/to/file.md).
- DO NOT use double brackets [[ ]] anywhere in the links.
- Use the EXACT vault-absolute paths provided in the 'VALID TOPICS' list below. These paths MUST start with the ontology root folder (e.g., /Ontology/...).
- **NEW TOPICS**: If you suggest a topic that is NOT in the 'VALID TOPICS' list:
    - You MUST provide a clear, concise definition for it.
    - For entities (people, organizations, places) or complex technical concepts, include at least one authoritative reference (e.g., a URL or specific source name) within the definition.
    - If suggesting multiple similar new topics (e.g. "Risk Management" vs "Enterprise Risk Management"), ensure their definitions clearly distinguish them and explain why they are separate.
- ALWAYS provide the full updated array for 'topics' or 'tags'.
- DO NOT link to "Index" files (e.g., Concepts/Concepts.md is an index, use files *inside* it).
- DO NOT suggest removing tags that look like plugin-specific markers (e.g. #excalidraw).
- Return ONLY valid JSON.

VALID TOPICS:
${validTopics.map(t => `- [${t.name}](/${t.path})`).join("\n")}

Analyze the following notes and suggest improvements.

NOTES:
${JSON.stringify(context, null, 2)}
`.trim();

            // 3. Generate structured plan
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
                                action: { type: "string", enum: ["update_topics", "update_tags", "update_metadata", "rename_file"] },
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
                                topicLink: { type: "string", description: "The full Markdown link [Name](/Path)." },
                                definition: { type: "string", description: "A clear definition of the topic." }
                            },
                            required: ["topicLink", "definition"]
                        },
                        description: "Definitions for any NEW topics suggested that weren't in the VALID TOPICS list."
                    }
                },
                required: ["date", "summary", "actions"]
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
# Gardener Plan - ${parsedPlan.date}

${parsedPlan.summary}

\`\`\`gardener-plan
${JSON.stringify(parsedPlan, null, 2)}
\`\`\`
`.trim();

            await this.app.vault.modify(planFile, content);
            logger.info(`Gardener Plan updated: ${planFile.path}`);

        } catch (error) {
            const errorObj = {
                date: new Date().toISOString().split('T')[0],
                summary: "Gardener analysis failed.",
                actions: [],
                error: error instanceof Error ? error.message : String(error)
            };

            const errorContent = `
# Gardener Plan - Failed

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
            if (child instanceof TFile && child.name.startsWith("Gardener Plan")) {
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
