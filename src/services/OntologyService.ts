import { App, TFolder, TFile, normalizePath } from "obsidian";
import { VaultIntelligenceSettings } from "../settings";
import { logger } from "../utils/logger";
import { ONTOLOGY_TEMPLATES } from "../templates/ontology-en-GB";

/**
 * Service to manage the vault's ontology and classification rules.
 */
export class OntologyService {
    private app: App;
    private settings: VaultIntelligenceSettings;

    constructor(app: App, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * Initializes the ontology service.
     * Checks if the ontology structure exists and offers to create it if missing.
     */
    public async initialize(): Promise<void> {
        await this.ensureOntologyStructure();
    }

    /**
     * Ensures the core ontology folder structure exists.
     * Creates folders and default index files if they don't exist.
     */
    public async ensureOntologyStructure(): Promise<void> {
        const basePath = normalizePath(this.settings.ontologyPath);

        try {
            // Create base folder
            if (!(this.app.vault.getAbstractFileByPath(basePath) instanceof TFolder)) {
                await this.app.vault.createFolder(basePath);
                logger.info(`Created base ontology folder: ${basePath}`);
            }

            // Create subfolders and templates
            await this.ensureFolderAndFile(normalizePath(`${basePath}/Concepts`), 'Concepts.md', ONTOLOGY_TEMPLATES.CONCEPTS);
            await this.ensureFolderAndFile(normalizePath(`${basePath}/Entities`), 'Entities.md', ONTOLOGY_TEMPLATES.ENTITIES);
            await this.ensureFolderAndFile(normalizePath(`${basePath}/MOCs`), 'MOCs.md', ONTOLOGY_TEMPLATES.MOCS);

            // Create default Instructions.md in root
            const instructionsPath = normalizePath(`${basePath}/Instructions.md`);
            if (!(this.app.vault.getAbstractFileByPath(instructionsPath) instanceof TFile)) {
                await this.app.vault.create(instructionsPath, ONTOLOGY_TEMPLATES.INSTRUCTIONS);
                logger.info(`Created default instructions: ${instructionsPath}`);
            }

        } catch (error) {
            logger.error(`Failed to ensure ontology structure at ${basePath}`, error);
        }
    }

    /**
     * Helper to ensure a subfolder and its main index file exist.
     */
    private async ensureFolderAndFile(folderPath: string, fileName: string, template: string): Promise<void> {
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.app.vault.createFolder(folderPath);
            logger.info(`Created folder: ${folderPath}`);
        }

        const filePath = normalizePath(`${folderPath}/${fileName}`);
        if (!(this.app.vault.getAbstractFileByPath(filePath) instanceof TFile)) {
            await this.app.vault.create(filePath, template);
            logger.info(`Created template file: ${filePath}`);
        }
    }

    /**
     * Retrieves all valid topics defined in the ontology folder.
     * Scanning recursively and excluding "index" files that share a name with their parent folder.
     */
    public async getValidTopics(): Promise<{ name: string, path: string }[]> {
        const basePath = normalizePath(this.settings.ontologyPath);
        const topics: { name: string, path: string }[] = [];

        await Promise.resolve(); // satisfying async lint
        const baseFolder = this.app.vault.getAbstractFileByPath(basePath);
        if (!(baseFolder instanceof TFolder)) return [];

        // Recursive scan
        const scan = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === "md") {
                    const cache = this.app.metadataCache.getFileCache(child);
                    const fm = cache?.frontmatter as Record<string, unknown> | undefined;

                    // 1. Check for Ignore/Exclude Flags
                    const gardener = fm?.["gardener"];
                    if (gardener === "ignore" || gardener === "exclude") continue;
                    if (typeof gardener === "object" && gardener !== null) {
                        const gObj = gardener as Record<string, unknown>;
                        if (gObj["ignore"] === true || gObj["exclude"] === true) {
                            continue;
                        }
                    }

                    // 2. Exclude Index Files
                    const parentFolderName = folder.name;
                    if (child.basename.toLowerCase() === parentFolderName.toLowerCase()) {
                        continue;
                    }

                    // 3. Add primary name
                    topics.push({
                        name: child.basename,
                        path: child.path
                    });

                    // 4. Add aliases
                    const aliases = fm?.["aliases"];
                    if (aliases) {
                        const aliasList = Array.isArray(aliases) ? aliases : [aliases];
                        for (const alias of aliasList) {
                            if (typeof alias === "string" && alias.trim()) {
                                topics.push({
                                    name: alias.trim(),
                                    path: child.path
                                });
                            }
                        }
                    }
                } else if (child instanceof TFolder) {
                    scan(child);
                }
            }
        };

        scan(baseFolder);
        return topics;
    }

    /**
     * Provides descriptions for all ontology folders by reading their index files.
     * Also checks for custom Instructions.md in the root.
     */
    public async getOntologyContext(): Promise<{ folders: Record<string, string>, instructions?: string }> {
        const basePath = normalizePath(this.settings.ontologyPath);
        const baseFolder = this.app.vault.getAbstractFileByPath(basePath);
        if (!(baseFolder instanceof TFolder)) return { folders: {} };

        const folders: Record<string, string> = {};
        let instructions: string | undefined;

        for (const child of baseFolder.children) {
            if (child instanceof TFolder) {
                // Look for index file: folder/folder.md
                const indexPath = normalizePath(`${child.path}/${child.name}.md`);
                const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
                if (indexFile instanceof TFile) {
                    const content = await this.app.vault.read(indexFile);
                    folders[child.name] = content.slice(0, 500); // First 500 chars
                }
            } else if (child instanceof TFile && child.name.toLowerCase() === "instructions.md") {
                instructions = await this.app.vault.read(child);
            }
        }

        return { folders, instructions };
    }

    /**
     * Helper to generate a URL-encoded Markdown link for a file.
     */
    public getMarkdownLink(name: string, path: string): string {
        // Obsidian paths should be vault-absolute and encoded
        const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
        return `[${name}](/${encodedPath})`;
    }

    /**
     * Validates if a topic path exists and is not an index file.
     */
    public validateTopic(topicPath: string): boolean {
        // Match [Name](/Path) - robust to extra brackets
        const match = topicPath.match(/\[+([^\]]+)\]+\(\/?([^)]+)\)/);
        const path = match && match[2] ? decodeURIComponent(match[2].trim()) : topicPath;

        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return false;

        // Ensure it's not an index file
        const parentFolder = file.parent;
        if (parentFolder && file.basename.toLowerCase() === parentFolder.name.toLowerCase()) {
            return false;
        }

        return true;
    }
}
