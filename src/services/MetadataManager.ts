import { TFile, TFolder, App } from "obsidian";

import { logger } from "../utils/logger";

/**
 * Service to manage metadata updates safely.
 * Centralizes vault modifications to handle potential race conditions and ensure consistency.
 */
export class MetadataManager {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Updates the frontmatter of a file safely.
     * @param file - The markdown file to update.
     * @param updates - A callback function that receives the current frontmatter and applies changes.
     * @returns A promise that resolves when the update is complete.
     */
    public async updateFrontmatter(file: TFile, updates: (frontmatter: Record<string, unknown>) => void): Promise<void> {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                updates(frontmatter);
            });
            logger.info(`Updated frontmatter for: ${file.path}`);
        } catch (error) {
            logger.error(`Failed to update frontmatter for: ${file.path}`, error);
            throw error;
        }
    }

    /**
     * Checks if a file has a specific key in its frontmatter.
     * @param file - The file to check.
     * @param key - The frontmatter key.
     * @returns True if the key exists.
     */
    public hasKey(file: TFile, key: string): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        return !!cache?.frontmatter && key in cache.frontmatter;
    }

    /**
     * Gets a specific frontmatter value.
     * @param file - The file to read.
     * @param key - The key to retrieve.
     * @returns The value or undefined.
     */
    public getKeyValue(file: TFile, key: string): unknown {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.frontmatter?.[key];
    }

    /**
     * Safely creates a folder if it doesn't already exist.
     * @param path - The path to the folder.
     */
    public async createFolderIfMissing(path: string): Promise<void> {
        if (!path) return;
        const folders = path.split('/');
        let currentPath = "";
        for (const folder of folders) {
            currentPath = currentPath ? `${currentPath}/${folder}` : folder;
            if (!(this.app.vault.getAbstractFileByPath(currentPath) instanceof TFolder)) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }

    /**
     * Safely creates a file with initial content if it doesn't already exist.
     * @param path - The path to the file.
     * @param content - The initial content of the file.
     */
    public async createFileIfMissing(path: string, content: string): Promise<void> {
        if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
            await this.app.vault.create(path, content);
        }
    }
}
