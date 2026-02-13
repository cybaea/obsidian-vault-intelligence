import { App, TFile } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { GraphSearchResult } from "../types/graph";
import { fastHash, splitFrontmatter } from "../utils/link-parsing";
import { logger } from "../utils/logger";
import { VaultManager } from "./VaultManager";

export interface HydrationResult {
    driftDetected: TFile[];
    hydrated: GraphSearchResult[];
}

/**
 * Service responsible for hydrating "hollow" search results from the worker
 * with actual content from the Obsidian vault.
 * Handles drift detection (self-healing) by comparing content hashes.
 */
export class ResultHydrator {
    private app: App;
    private vaultManager: VaultManager;

    constructor(app: App, vaultManager: VaultManager) {
        this.app = app;
        this.vaultManager = vaultManager;
    }

    /**
     * Hydrates a list of results. 
     * Returns the hydrated results and a list of files that need re-indexing due to drift.
     */
    public async hydrate(results: GraphSearchResult[]): Promise<HydrationResult> {
        const hydrated: GraphSearchResult[] = [];
        const driftDetected: TFile[] = [];

        for (const res of results) {
            // Case 1: Vector Result (Has excerpt from Worker)
            if (res.excerpt && res.excerpt.length > 0) {
                // ACTION: Clean the raw worker snippet before displaying
                hydrated.push({
                    ...res,
                    excerpt: this.cleanSnippet(res.excerpt)
                });
                continue;
            }

            // Case 2: Graph Neighbor (Needs text from disk)
            const file = this.app.vault.getAbstractFileByPath(res.path);
            if (!(file instanceof TFile)) {
                hydrated.push(res);
                continue;
            }

            try {
                const alignedContent = await this.anchoredAlignment(
                    file,
                    res.anchorHash ?? 0,
                    res.start ?? 0,
                    res.end ?? 0
                );

                // ACTION: Clean the hydrated content
                const finalExcerpt = alignedContent
                    ? this.cleanSnippet(alignedContent)
                    : "(Content drifted - Re-indexing in background)";

                hydrated.push({
                    ...res,
                    excerpt: finalExcerpt
                });

                if (!alignedContent) {
                    driftDetected.push(file);
                }
            } catch (e) {
                logger.error(`[ResultHydrator] Hydration failed for ${res.path}:`, e);
                hydrated.push(res);
            }
        }

        return { driftDetected, hydrated };
    }

    /**
     * post-processes raw markdown into a clean UI snippet.
     * Removes headers, images, and collapses whitespace.
     */
    private cleanSnippet(text: string): string {
        if (!text) return "";

        // 1. Remove Markdown headers (lines starting with #) to show the content below them
        let clean = text.replace(/^#{1,6}\s+.*$/gm, " ");

        // 2. Remove images and strict markdown links
        clean = clean
            .replace(/!\[\[.*?\]\]/g, "") // Remove image embeds
            .replace(/!\[.*?\]\(.*?\)/g, "") // Remove standard images
            .replace(/^>\s?/gm, "") // Remove blockquote markers
            .replace(/```[\s\S]*?```/g, " [Code Block] "); // Simplify code blocks

        // 3. Collapse whitespace (newlines to spaces) for compact view
        clean = clean.replace(/\s+/g, " ").trim();

        // 4. Fallback: If cleaning removed everything (e.g. chunk was ONLY a header), 
        // return the header title itself (without the #)
        if (clean.length === 0) {
            const headerMatch = text.match(/^#{1,6}\s+(.*)$/m);
            if (headerMatch) return headerMatch[1] || "";
        }

        // 5. Truncate to a reasonable length for the sidebar
        const limit = GRAPH_CONSTANTS.FALLBACK_EXCERPT_LENGTH || 300;
        if (clean.length > limit) {
            return clean.substring(0, limit) + "...";
        }

        return clean;
    }

    /**
     * Aligns search results with current file content using hash anchors.
     * This handles "drift" where the file has changed but the index hasn't caught up.
     */
    private async anchoredAlignment(file: TFile, expectedHash: number, start: number, end: number): Promise<string | null> {
        const content = await this.vaultManager.readFile(file);
        const { body } = splitFrontmatter(content);

        // FALLBACK: If no anchor/offsets (Graph Neighbor only), show start of body
        if (!expectedHash && !start && !end) {
            // Strip markdown-style links/images for cleaner UI if it's a raw fallback
            const cleanBody = body.replace(/!\[\[.*?\]\]/g, '').replace(/!\[.*?\]\(.*?\)/g, '');
            return cleanBody.substring(0, GRAPH_CONSTANTS.FALLBACK_EXCERPT_LENGTH).trim() + "...";
        }

        // 1. Direct match check (worker start/end is relative to full file content)
        const snippet = content.substring(start, end);
        if (fastHash(snippet) === expectedHash) return snippet.trim();

        // 2. Drift Detection: Look for anchor in a sliding window
        const searchRange = GRAPH_CONSTANTS.HYDRATION_SEARCH_RANGE;
        const searchStart = Math.max(0, start - searchRange);
        const searchEnd = Math.min(content.length, end + searchRange);
        const window = content.substring(searchStart, searchEnd);
        const chunkLength = end - start;

        // Slide a window of the exact chunk length across the search range
        for (let i = 0; i <= window.length - chunkLength; i++) {
            const candidate = window.substring(i, i + chunkLength);
            if (fastHash(candidate) === expectedHash) {
                return candidate.trim();
            }
        }

        return null; // Deep drift
    }
}
