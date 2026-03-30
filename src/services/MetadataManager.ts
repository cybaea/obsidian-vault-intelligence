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

    /**
     * Replaces vault links from a source topic to a target topic safely using AST character offsets.
     * @param neighbors - Array of file paths that link to the source topic.
     * @param sourceTopic - The vault path of the topic being merged/deleted.
     * @param targetTopic - The vault path of the surviving target topic.
     */
    public async replaceLinksAsync(neighbors: string[], sourceTopic: string, targetTopic: string): Promise<void> {
        for (const neighborPath of neighbors) {
            const file = this.app.vault.getAbstractFileByPath(neighborPath);
            if (!(file instanceof TFile)) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache || !cache.links) continue;

            const linksToReplace = cache.links.filter(link => {
                const linkPath = link.link.split('#')[0] || '';
                return linkPath === sourceTopic || this.app.metadataCache.getFirstLinkpathDest(linkPath, neighborPath)?.path === sourceTopic;
            });

            const sourceName = sourceTopic.split('/').pop()?.replace('.md', '') || sourceTopic;
            // Target is an absolute vault path string here (usually starting from root but without starting / if normalizePath)
            const cleanTargetTopic = targetTopic.replace(/\.md$/, '');

            if (linksToReplace.length > 0) {
                // Sort descending by offset so we don't mess up subsequent offsets when slicing
                linksToReplace.sort((a, b) => b.position.start.offset - a.position.start.offset);

                let content = await this.app.vault.cachedRead(file);
                let modified = false;

                for (const link of linksToReplace) {
                    const start = link.position.start.offset;
                    const end = link.position.end.offset;
                    
                    const originalLinkText = content.slice(start, end);
                    
                    let alias = sourceName;
                    if (link.displayText && link.displayText !== link.link) {
                        alias = link.displayText;
                    } else if (originalLinkText.includes("|")) {
                        const match = originalLinkText.match(/\|([^\]]+)\]\]/);
                        if (match && match[1]) alias = match[1];
                    }
                    
                    const newLink = `[[${cleanTargetTopic}|${alias}]]`;
                    content = content.slice(0, start) + newLink + content.slice(end);
                    modified = true;
                }

                if (modified) {
                    await this.app.vault.modify(file, content);
                    logger.info(`Replaced ${linksToReplace.length} links to ${sourceTopic} in ${neighborPath}`);
                }
            }

            // Also check and update frontmatter topics (since cache.links often ignores frontmatter lists)
            if (cache.frontmatter && cache.frontmatter.topics) {
                await this.updateFrontmatter(file, (fm) => {
                    let fmModified = false;
                    if (Array.isArray(fm.topics)) {
                        const newTopics = fm.topics.map((t: unknown) => {
                            const tStr = String(t);
                            // Check for exact path or basename match within wikilink syntax
                            if (tStr.includes(sourceName) || tStr.includes(sourceTopic)) {
                                fmModified = true;
                                return `[[${cleanTargetTopic}|${sourceName}]]`;
                            }
                            return t;
                        });
                        if (fmModified) {
                            fm.topics = Array.from(new Set(newTopics.map(String)));
                        }
                    } else if (typeof fm.topics === "string") {
                        const tStr = String(fm.topics);
                        if (tStr.includes(sourceName) || tStr.includes(sourceTopic)) {
                            fm.topics = [`[[${cleanTargetTopic}|${sourceName}]]`];
                        }
                    }
                });
            }
        }
    }
}
