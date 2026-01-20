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
    public async assemble(results: VaultSearchResult[], query: string, budgetChars: number): Promise<string> {
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

                // DECISION: Full Content vs. Smart Window
                // We use full content IF:
                // 1. It fits in the remaining budget AND
                // 2. It is smaller than the 'Soft Limit' (to prevent starvation of other docs)
                const fitsInBudget = (currentUsage + content.length) < budgetChars;
                const isNotTooHuge = content.length < singleDocSoftLimit;

                if (fitsInBudget && isNotTooHuge) {
                    contentToAdd = content;
                    logger.debug(`[ContextAssembler] Added full file: ${file.path} (${content.length} chars)`);
                } else {
                    // Fallback: Use Smart Windowing (clipping)
                    // We take a slice of the document centered on the keyword
                    logger.debug(`[ContextAssembler] Clipping file ${file.path} (Size: ${content.length}).`);

                    // Calculate how much space we can reasonably give this doc
                    // (Either the remaining budget OR the soft limit, whichever is smaller)
                    const availableSpace = Math.min(singleDocSoftLimit, budgetChars - currentUsage);

                    if (availableSpace < SEARCH_CONSTANTS.MIN_DOC_CONTEXT_CHARS) continue; // Skip if too little space left

                    if (doc.isKeywordMatch) {
                        // Center window on match
                        const idx = content.toLowerCase().indexOf(query.toLowerCase());
                        if (idx !== -1) {
                            const halfWindow = Math.floor(availableSpace / 2);
                            const start = Math.max(0, idx - halfWindow);
                            const end = Math.min(content.length, idx + halfWindow);
                            contentToAdd = `...[clipped]...\n${content.substring(start, end)}\n...[clipped]...`;
                        } else {
                            contentToAdd = content.substring(0, availableSpace) + "\n...[clipped]...";
                        }
                    } else {
                        // Vector match without keyword? Just take the start.
                        contentToAdd = content.substring(0, availableSpace) + "\n...[clipped]...";
                    }
                    logger.debug(`[ContextAssembler] Added clipped file: ${file.path} (${contentToAdd.length} chars)`);
                }

                const header = `\n--- Document: ${doc.path} (Score: ${doc.score.toFixed(2)}) ---\n`;
                constructedContext += header + contentToAdd + "\n";
                currentUsage += contentToAdd.length;
                includedCount++;

            } catch (e) {
                logger.error(`Failed to read file for context: ${doc.path}`, e);
            }
        }

        return constructedContext;
    }
}
