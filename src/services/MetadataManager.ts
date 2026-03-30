import { TFile, TFolder, App, parseLinktext } from "obsidian";

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
            logger.info(`Updated frontmatter for: ${file.path || 'unknown'}`);
        } catch (error) {
            logger.error(`Failed to update frontmatter for: ${file.path || 'unknown'}`, error);
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
     * Safely archives a file to a designated archive folder.
     * @param file - The file to archive.
     * @param archiveFolderPath - The path to the archive folder.
     */
    public async archiveFileAsync(file: TFile, archiveFolderPath: string): Promise<void> {
        await this.createFolderIfMissing(archiveFolderPath);
        const newPath = `${archiveFolderPath}/${file.name}`;
        
        // Prevent overwriting existing archived files with the same name
        if (this.app.vault.getAbstractFileByPath(newPath)) {
            logger.warn(`Archive file already exists at ${newPath}. Generating unique name to prevent overwrite.`);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const uniquePath = `${archiveFolderPath}/${file.basename}_${timestamp}.${file.extension}`;
            await this.app.fileManager.renameFile(file, uniquePath);
            logger.info(`Archived file from ${file.path} to ${uniquePath}`);
            return;
        }

        await this.app.fileManager.renameFile(file, newPath);
        logger.info(`Archived file from ${file.path} to ${newPath}`);
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
                    
                    // Use native parsing for Wikilinks
                    if (originalLinkText.startsWith("[[")) {
                        const inner = originalLinkText.replace(/^\[\[/, "").replace(/\]\]$/, "");
                        const [linkPart, ...aliasParts] = inner.split("|");
                        parseLinktext(linkPart || ""); // Validate format
                        if (aliasParts.length > 0) {
                            alias = aliasParts.join("|");
                        }
                    } else if (link.displayText && link.displayText !== link.link) {
                        // For Markdown links, Obsidian populates displayText
                        alias = link.displayText;
                    }
                    
                    // If the alias is the same as the target path or source name, we might want to simplify
                    // but usually, we just preserve what was there.
                    const newLink = `[[${cleanTargetTopic}${alias && alias !== cleanTargetTopic ? "|" + alias : ""}]]`;
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
                // Map of original string -> resolved path from Obsidian's reference cache
                const linkMap = new Map<string, string>();
                if (cache.frontmatterLinks) {
                    for (const ref of cache.frontmatterLinks) {
                        if (ref.key === "topics") {
                            const dest = this.app.metadataCache.getFirstLinkpathDest(ref.link, neighborPath);
                            if (dest) linkMap.set(ref.original, dest.path);
                        }
                    }
                }

                await this.updateFrontmatter(file, (fm) => {
                    if (!fm.topics) return;
                    
                    const originalTopics = Array.isArray(fm.topics) ? fm.topics : (typeof fm.topics === "string" ? [fm.topics] : []);
                    const seenTargets = new Set<string>();
                    const finalTopics: string[] = [];
                    let fmModified = false;

                    for (const topic of originalTopics) {
                        const tStr = String(topic);
                        
                        // 1. Resolve target path using Obsidian's cache (preferred) or best-effort regex (fallback)
                        let resolvedPath = linkMap.get(tStr) || null;
                        
                        // Fallback for stale cache or links Obsidian missed (using native parseLinktext or best-effort regex for Markdown)
                        if (!resolvedPath) {
                            if (tStr.startsWith("[[")) {
                                const inner = tStr.replace(/^\[\[/, "").replace(/\]\]$/, "");
                                const [linkPart] = inner.split("|");
                                const parsed = parseLinktext(linkPart || "");
                                const dest = this.app.metadataCache.getFirstLinkpathDest(parsed.path, neighborPath);
                                if (dest) resolvedPath = dest.path;
                            } else {
                                const mdMatch = tStr.match(/\[[^\]]*\]\(([^)]+)\)/);
                                if (mdMatch && mdMatch[1]) {
                                    const path = decodeURIComponent(mdMatch[1]).split("#")[0] || "";
                                    const dest = this.app.metadataCache.getFirstLinkpathDest(path, neighborPath);
                                    if (dest) resolvedPath = dest.path;
                                }
                            }
                        }

                        // 2. Determine if this topic points to the source we are merging
                        let isMergingSource = false;
                        if (resolvedPath === sourceTopic) {
                            resolvedPath = targetTopic;
                            isMergingSource = true;
                            fmModified = true;
                        }

                        if (resolvedPath) {
                            // De-duplication: only add if we haven't seen this target file yet
                            if (!seenTargets.has(resolvedPath)) {
                                seenTargets.add(resolvedPath);
                                
                                // Construct the canonical link for the topic
                                if (resolvedPath === targetTopic || resolvedPath === targetTopic.replace(/\.md$/, "")) {
                                    // If this was rewired from source, use sourceName as alias
                                    if (isMergingSource && tStr.includes(sourceName)) {
                                        finalTopics.push(`[[${cleanTargetTopic}|${sourceName}]]`);
                                    } else {
                                        // Standardize to Wikilink but preserve alias if present
                                        let alias = "";
                                        if (tStr.startsWith("[[")) {
                                            const inner = tStr.replace(/^\[\[/, "").replace(/\]\]$/, "");
                                            const [, ...aliasParts] = inner.split("|");
                                            if (aliasParts.length > 0) {
                                                alias = aliasParts.join("|");
                                            }
                                        }
                                        finalTopics.push(`[[${cleanTargetTopic}${alias && alias !== cleanTargetTopic ? "|" + alias : ""}]]`);
                                    }
                                } else {
                                    // Keep existing format for other topics if possible, or standardize
                                    finalTopics.push(tStr);
                                }
                            } else {
                                // Redundant topic found!
                                fmModified = true;
                            }
                        } else {
                            // Doesn't resolve to a file (plain text), just keep it
                            finalTopics.push(tStr);
                        }
                    }

                    if (fmModified) {
                        fm.topics = finalTopics;
                    }
                });
            }
        }
    }
}
