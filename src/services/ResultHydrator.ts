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
            // If we already have an excerpt, no hydration needed
            if (res.excerpt && res.excerpt.length > 0) {
                hydrated.push(res);
                continue;
            }

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

                hydrated.push({
                    ...res,
                    excerpt: alignedContent ?? "(Content drifted - Re-indexing in background)"
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
        const snippet = content.substring(start, end).trim();
        if (fastHash(snippet) === expectedHash) return snippet;

        // 2. Drift Detection: Look for anchor in a sliding window
        const searchRange = GRAPH_CONSTANTS.HYDRATION_SEARCH_RANGE;
        const searchStart = Math.max(0, start - searchRange);
        const searchEnd = Math.min(content.length, end + searchRange);
        const window = content.substring(searchStart, searchEnd);

        const lines = window.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            if (fastHash(line) === expectedHash) {
                const actualStart = window.indexOf(line);
                return window.substring(actualStart, actualStart + (end - start)).trim();
            }
        }

        return null; // Deep drift
    }
}
