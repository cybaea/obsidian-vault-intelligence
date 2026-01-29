import { App, TFolder, TFile, normalizePath } from "obsidian";

import { VaultIntelligenceSettings } from "../settings";
import { ONTOLOGY_TEMPLATES } from "../templates/ontology-en-GB";
import { logger } from "../utils/logger";

/**
 * Service to manage the vault's ontology and classification rules.
 */
/**
 * Service responsible for managing the vault's ontology and knowledge model.
 * It handles concept validation, topic discovery, and structural rules.
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
        if (!basePath || basePath === "." || basePath === "/") return;

        try {
            // 1. Ensure base folder
            await this.ensureFolder(basePath);

            // 2. Ensure subfolders and templates
            await this.ensureFolderAndFile(normalizePath(`${basePath}/Concepts`), 'Concepts.md', ONTOLOGY_TEMPLATES.CONCEPTS);
            await this.ensureFolderAndFile(normalizePath(`${basePath}/Entities`), 'Entities.md', ONTOLOGY_TEMPLATES.ENTITIES);
            await this.ensureFolderAndFile(normalizePath(`${basePath}/MOCs`), 'MOCs.md', ONTOLOGY_TEMPLATES.MOCS);

            // 3. Create default Instructions.md in root
            const instructionsPath = normalizePath(`${basePath}/Instructions.md`);
            await this.ensureFile(instructionsPath, ONTOLOGY_TEMPLATES.INSTRUCTIONS, "default instructions");

        } catch (error) {
            logger.error(`Failed to ensure ontology structure at ${basePath}`, error);
        }
    }

    /**
     * Helper to ensure a subfolder and its main index file exist.
     */
    private async ensureFolderAndFile(folderPath: string, fileName: string, template: string): Promise<void> {
        await this.ensureFolder(folderPath);

        const filePath = normalizePath(`${folderPath}/${fileName}`);
        await this.ensureFile(filePath, template, "template file");
    }

    /**
     * Robust file creation that handles "Already exists" errors gracefully.
     */
    private async ensureFile(path: string, content: string, label: string = "file"): Promise<void> {
        const normalizedPath = normalizePath(path);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (file instanceof TFile) return;

        if (file instanceof TFolder) {
            logger.warn(`Cannot create ${label} ${normalizedPath} because a folder already exists at this path.`);
            return;
        }

        try {
            await this.app.vault.create(normalizedPath, content);
            logger.info(`Created ${label}: ${normalizedPath}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.toLowerCase().includes('already exists')) {
                logger.debug(`${label} ${normalizedPath} already exists (checked during creation).`);
            } else {
                throw new Error(`Failed to create ${label} ${normalizedPath}: ${msg}`);
            }
        }
    }

    /**
     * Robust folder creation that handles "Already exists" errors gracefully.
     */
    private async ensureFolder(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (folder instanceof TFolder) return;

        if (folder instanceof TFile) {
            logger.warn(`Cannot create folder ${normalizedPath} because a file already exists at this path.`);
            return;
        }

        try {
            await this.app.vault.createFolder(normalizedPath);
            logger.info(`Created folder: ${normalizedPath}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.toLowerCase().includes('already exists')) {
                logger.debug(`Folder ${normalizedPath} already exists (checked during creation).`);
            } else {
                throw new Error(`Failed to create folder ${normalizedPath}: ${msg}`);
            }
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
    /**
     * Retrieves the full ontology context for use by AI agents.
     * @returns Object containing folder mappings and instructions.
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
