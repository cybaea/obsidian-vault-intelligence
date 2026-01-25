import { App, TFile } from "obsidian";
import { SEARCH_CONSTANTS } from "../constants";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";

export class ContextAssembler {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Dynamically assembles context from search results based on the provided token budget.
     */
    public async assemble(results: VaultSearchResult[], query: string, budgetChars: number): Promise<{ context: string; usedFiles: string[] }> {
        // Define "Starvation Protection" limit
        // No single document should take up more than 25% of the budget if there are other results.
        const singleDocSoftLimit = Math.floor(budgetChars * SEARCH_CONSTANTS.SINGLE_DOC_SOFT_LIMIT_RATIO);

        logger.debug(`[ContextAssembler] Budget: ${budgetChars} chars. Soft Cap: ${singleDocSoftLimit} chars.`);

        let constructedContext = "";
        let currentUsage = 0;
        let includedCount = 0;

        for (const doc of results) {
            // Check if we are already full
            if (currentUsage >= budgetChars) {
                logger.info(`[ContextAssembler] Budget exhausted after ${includedCount} documents.`);
                break;
            }

            const file = this.app.vault.getAbstractFileByPath(doc.path);
            if (!(file instanceof TFile)) continue;

            try {
                const content = await this.app.vault.read(file);
                let contentToAdd = "";

                // GARS-Aware Density (Accordion Logic)
                // 1. High Score (> 0.8): Direct relevant context -> Try to include full/large content.
                // 2. Medium Score (0.4 - 0.8): Supporting context -> Use Smart Windowing.
                // 3. Low Score (< 0.4): Minimal context -> Metadata/Summary only to save tokens.

                if (doc.score > 0.8) {
                    // Scenario: High Relevance. 
                    // Use full content if it fits the soft limit, else center on keyword.
                    const isNotTooHuge = content.length < singleDocSoftLimit;
                    const fitsInBudget = (currentUsage + content.length) < budgetChars;

                    if (isNotTooHuge && fitsInBudget) {
                        contentToAdd = content;
                        logger.debug(`[ContextAssembler] [Accordion:HIGH] Added full file: ${file.path}`);
                    } else {
                        const availableSpace = Math.min(singleDocSoftLimit, budgetChars - currentUsage);
                        contentToAdd = this.clipContent(content, query, availableSpace, !!doc.isKeywordMatch);
                        logger.debug(`[ContextAssembler] [Accordion:HIGH] Clipped file: ${file.path}`);
                    }
                } else if (doc.score >= 0.4) {
                    // Scenario: Supporting Relevance.
                    // Strictly use a smaller window (half of the soft limit) to leave room for others.
                    const supportWindow = Math.floor(singleDocSoftLimit / 2);
                    const availableSpace = Math.min(supportWindow, budgetChars - currentUsage);

                    if (availableSpace > SEARCH_CONSTANTS.MIN_DOC_CONTEXT_CHARS) {
                        contentToAdd = this.clipContent(content, query, availableSpace, !!doc.isKeywordMatch);
                        logger.debug(`[ContextAssembler] [Accordion:MED] Added snippet: ${file.path}`);
                    }
                } else {
                    // Scenario: Peripheral Relevance (Neighbors).
                    // Just add the metadata header to let the agent know it exists.
                    contentToAdd = "... (Note available via get_connected_notes tool if needed) ...";
                    logger.debug(`[ContextAssembler] [Accordion:LOW] Added metadata only: ${file.path}`);
                }

                if (contentToAdd) {
                    const header = `\n--- Document: ${doc.path} (Relevance Score: ${doc.score.toFixed(2)}) ---\n`;
                    constructedContext += header + contentToAdd + "\n";
                    currentUsage += contentToAdd.length;
                    includedCount++;
                }

            } catch (e) {
                logger.error(`Failed to read file for context: ${doc.path}`, e);
            }
        }

        return { context: constructedContext, usedFiles: Array.from(new Set(results.slice(0, includedCount).map(r => r.path))) };
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
