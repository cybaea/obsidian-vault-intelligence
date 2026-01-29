import { App, TFile } from "obsidian";

import { SEARCH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { GraphService } from "./GraphService";

export class ContextAssembler {
    private app: App;
    private graphService?: GraphService;
    private settings?: VaultIntelligenceSettings;

    constructor(app: App, graphService?: GraphService, settings?: VaultIntelligenceSettings) {
        this.app = app;
        this.graphService = graphService;
        this.settings = settings;
    }

    /**
     * Dynamically assembles context from search results based on the provided token budget.
     * Use relative score gaps to determine context density.
     */
    public async assemble(results: VaultSearchResult[], query: string, budgetChars: number): Promise<{ context: string; usedFiles: string[] }> {
        // Starvation Protection
        const singleDocSoftLimit = Math.floor(budgetChars * SEARCH_CONSTANTS.SINGLE_DOC_SOFT_LIMIT_RATIO);

        logger.debug(`[ContextAssembler] Budget: ${budgetChars} chars. Soft Cap: ${singleDocSoftLimit} chars.`);

        let constructedContext = "";
        let currentUsage = 0;
        let includedCount = 0;
        let structuralCount = 0;

        // Sort by score
        const sortedResults = [...results].sort((a, b) => b.score - a.score);
        const topScore = sortedResults[0]?.score || 0;

        // BATCH METADATA FETCH: Fetch all needed metadata in one worker call to avoid loop overhead
        const resultPaths = sortedResults.map(r => r.path);
        const metadataMap = this.graphService ? await this.graphService.getBatchMetadata(resultPaths) : {};

        // Settings / Thresholds
        const primaryThreshold = this.settings?.contextPrimaryThreshold || SEARCH_CONSTANTS.DEFAULT_CONTEXT_PRIMARY_THRESHOLD;
        const supportingThreshold = this.settings?.contextSupportingThreshold || SEARCH_CONSTANTS.DEFAULT_CONTEXT_SUPPORTING_THRESHOLD;
        const structuralThreshold = this.settings?.contextStructuralThreshold || SEARCH_CONSTANTS.DEFAULT_CONTEXT_STRUCTURAL_THRESHOLD;
        const maxFiles = this.settings?.contextMaxFiles || SEARCH_CONSTANTS.DEFAULT_CONTEXT_MAX_FILES;

        for (const doc of sortedResults) {
            // Check if we are already full or hit a safety limit
            if (currentUsage >= budgetChars || includedCount >= maxFiles) {
                const reason = currentUsage >= budgetChars ? "Budget exhausted" : `Max document safety limit (${maxFiles}) reached`;
                logger.info(`[ContextAssembler] Stop assembly: ${reason} after ${includedCount} documents.`);
                break;
            }

            const file = this.app.vault.getAbstractFileByPath(doc.path);
            if (!(file instanceof TFile)) continue;

            try {
                // Use cachedRead for zero-latency memory access
                const content = await this.app.vault.cachedRead(file);
                let contentToAdd = "";

                /**
                 * DYNAMIC RELATIVE ACCORDION LOGIC
                 * 1. Primary Tier (Score > Primary % of top): High confidence. Full file allowed.
                 * 2. Supporting Tier (Score Supporting % to Primary % of top): Medium confidence. Snippet allowed.
                 * 3. Structural Tier (Score Structural % to Supporting % of top): Low confidence / Neighbor. Headers only.
                 * 4. Skip: Below structural threshold.
                 */
                const relativeRelevance = topScore > 0 ? (doc.score / topScore) : 0;

                if (relativeRelevance >= primaryThreshold) {
                    // Scenario: Primary relevance.
                    const isNotTooHuge = content.length < singleDocSoftLimit;
                    const fitsInBudget = (currentUsage + content.length) < budgetChars;

                    if (isNotTooHuge && fitsInBudget) {
                        contentToAdd = content;
                        logger.debug(`[ContextAssembler] [Accordion:PRIMARY] (${(relativeRelevance * 100).toFixed(0)}% rel) full file: ${file.path}`);
                    } else {
                        const availableSpace = Math.min(singleDocSoftLimit, budgetChars - currentUsage);
                        contentToAdd = this.clipContent(content, query, availableSpace, !!doc.isKeywordMatch);
                        logger.debug(`[ContextAssembler] [Accordion:PRIMARY] (${(relativeRelevance * 100).toFixed(0)}% rel) clipped: ${file.path}`);
                    }
                } else if (relativeRelevance >= supportingThreshold) {
                    // Scenario: Supporting relevance.
                    const supportWindow = Math.floor(singleDocSoftLimit / 2);
                    const availableSpace = Math.min(supportWindow, budgetChars - currentUsage);

                    if (availableSpace > SEARCH_CONSTANTS.MIN_DOC_CONTEXT_CHARS) {
                        contentToAdd = this.clipContent(content, query, availableSpace, !!doc.isKeywordMatch);
                        logger.debug(`[ContextAssembler] [Accordion:SUPPORT] (${(relativeRelevance * 100).toFixed(0)}% rel) snippet: ${file.path}`);
                    }
                } else if (relativeRelevance >= structuralThreshold) {
                    // Scenario: Structural context.
                    // NEW: Check structural cap
                    if (structuralCount >= SEARCH_CONSTANTS.MAX_STRUCTURAL_DOCS) {
                        logger.debug(`[ContextAssembler] [Accordion:SKIP] Structural cap reached for: ${file.path}`);
                        continue;
                    }

                    // Use pre-fetched headers for a "Table of Contents" view.
                    const meta = metadataMap[doc.path];
                    const headers = meta?.headers || [];

                    if (headers.length > 0) {
                        contentToAdd = "Note Structure / Key Topics:\n" + headers.map(h => `- ${h}`).join('\n') + "\n... (Full content available via search) ...";
                    } else {
                        contentToAdd = "... (Note details available via search or tools if needed) ...";
                    }
                    structuralCount++;
                    logger.debug(`[ContextAssembler] [Accordion:STRUCTURAL] (${(relativeRelevance * 100).toFixed(0)}% rel) headers only: ${file.path}`);
                } else {
                    // Scenario: Below threshold, skip entirely to avoid bloat.
                    logger.debug(`[ContextAssembler] [Accordion:SKIP] (${(relativeRelevance * 100).toFixed(0)}% rel) below threshold: ${file.path}`);
                    continue;
                }

                if (contentToAdd) {
                    const header = `\n--- Document: ${doc.path} (Relevance: ${doc.score.toFixed(2)}) ---\n`;
                    constructedContext += header + contentToAdd + "\n";
                    currentUsage += contentToAdd.length;
                    includedCount++;
                }

            } catch (e) {
                logger.error(`Failed to read file for context: ${doc.path}`, e);
            }
        }

        return { context: constructedContext, usedFiles: Array.from(new Set(sortedResults.slice(0, includedCount).map(r => r.path))) };
    }

    private clipContent(content: string, query: string, availableSpace: number, isKeywordMatch: boolean): string {
        if (availableSpace < SEARCH_CONSTANTS.MIN_DOC_CONTEXT_CHARS) return "";

        if (isKeywordMatch) {
            const idx = content.toLowerCase().indexOf(query.toLowerCase());
            if (idx !== -1) {
                const halfWindow = Math.floor(availableSpace / 2);
                const start = Math.max(0, idx - halfWindow);
                const end = Math.min(content.length, idx + halfWindow);
                return `...[clipped]...\n${content.substring(start, end)}\n...[clipped]...`;
            }
        }

        // Default: Start of doc
        return content.substring(0, availableSpace) + "\n...[clipped]...";
    }
}
