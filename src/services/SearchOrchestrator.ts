import { App } from "obsidian";
import { GraphService } from "./GraphService";
import { ScoringStrategy } from "./ScoringStrategy";

import { SEARCH_CONSTANTS } from "../constants";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";

/**
 * Service that orchestrates hybrid search across the vault.
 * Combines vector search results with keyword matching for optimal recall and precision.
 */
export class SearchOrchestrator {
    private app: App;
    private graphService: GraphService;
    private scoringStrategy: ScoringStrategy;

    constructor(app: App, graphService: GraphService) {
        this.app = app;
        this.graphService = graphService;
        this.scoringStrategy = new ScoringStrategy();
    }

    /**
     * Performs a hybrid search (Vector + Keyword) on the vault.
     * @param query - The user's search query.
     * @param limit - Maximum number of final results to return.
     * @returns A promise resolving to a ranked list of search results.
     */
    public async search(query: string, limit: number): Promise<VaultSearchResult[]> {
        if (!query || query.trim().length === 0) {
            logger.warn("Vault search called with empty query.");
            return [];
        }

        logger.info(`[SearchOrchestrator] Starting search for: "${query}"`);

        // 1. Vector Search (Semantic)
        let vectorResults = await this.graphService.search(query, limit);
        logger.info(`[SearchOrchestrator] Vector search returned ${vectorResults.length} candidates.`);

        // 2. Keyword Search (Hybrid: Exact + Bag-of-Words)
        const keywordResults: VaultSearchResult[] = await this.performKeywordSearch(query);

        // 3. Hybrid Merge & Rank
        return this.mergeAndRank(vectorResults, keywordResults, limit);
    }

    private async performKeywordSearch(query: string): Promise<VaultSearchResult[]> {
        const keywordResults: VaultSearchResult[] = [];

        if (query.length <= 2) return [];

        const files = this.app.vault.getMarkdownFiles();

        // Token Cleaning
        // 1. Remove quotes
        // 2. Remove boolean operators (OR, AND) which the Agent likes to use
        // 3. Filter short words
        const cleanQuery = query.replace(/["'()]/g, " ");
        const tokens = cleanQuery.split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length > 2 && t !== "or" && t !== "and");

        const isMultiWord = tokens.length > 1;
        let keywordMatchesFound = 0;
        const maxMatches = SEARCH_CONSTANTS.MAX_KEYWORD_MATCHES;

        for (const file of files) {
            if (keywordMatchesFound >= maxMatches) break;

            const titleLower = file.basename.toLowerCase();

            // A. Title Exact Match
            const titleScore = this.scoringStrategy.calculateTitleScore(titleLower, query);
            if (titleScore !== null) {
                keywordResults.push({ path: file.path, score: titleScore, isKeywordMatch: true, isTitleMatch: true });
                keywordMatchesFound++;
                continue;
            }

            // B. Body Scan
            try {
                const content = await this.app.vault.cachedRead(file);
                const contentLower = content.toLowerCase();

                // B1. Exact Phrase Match (Highest Body Score)
                const bodyExactScore = this.scoringStrategy.calculateExactBodyScore(contentLower, query);
                if (bodyExactScore !== null) {
                    keywordResults.push({ path: file.path, score: bodyExactScore, isKeywordMatch: true, isTitleMatch: false });
                    keywordMatchesFound++;
                    continue;
                }

                // B2. "Bag of Words" Match (Flexible)
                if (isMultiWord) {
                    const fuzzyScore = this.scoringStrategy.calculateFuzzyScore(tokens, contentLower);

                    if (fuzzyScore > 0) {
                        keywordResults.push({ path: file.path, score: fuzzyScore, isKeywordMatch: true, isTitleMatch: false });
                        keywordMatchesFound++;
                    }
                }
            } catch { /* ignore read errors */ }
        }
        logger.info(`[SearchOrchestrator] Keyword search found ${keywordResults.length} matches for "${query}" (Exact + Fuzzy).`);
        return keywordResults;
    }

    private mergeAndRank(vectorResults: VaultSearchResult[], keywordResults: VaultSearchResult[], limit: number): VaultSearchResult[] {
        const mergedMap = new Map<string, VaultSearchResult>();

        // Add Vector Results
        for (const res of vectorResults) {
            mergedMap.set(res.path, res);
        }

        // Add/Merge Keyword Results
        for (const res of keywordResults) {
            const existing = mergedMap.get(res.path);

            if (existing !== undefined) {
                logger.debug(`[SearchOrchestrator] Boosting score for: ${res.path} (Vector + Keyword)`);
                existing.score = this.scoringStrategy.boostHybridResult(existing.score, {
                    score: res.score,
                    isKeywordMatch: !!res.isKeywordMatch,
                    isTitleMatch: !!res.isTitleMatch
                });
                existing.isKeywordMatch = true;
            } else {
                mergedMap.set(res.path, res);
            }
        }

        const finalResults = Array.from(mergedMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.info(`[SearchOrchestrator] Final ranked results: ${finalResults.length} docs.`);

        const topMatch = finalResults[0];
        if (topMatch) {
            logger.info(`[SearchOrchestrator] Top match: ${topMatch.path} (Score: ${topMatch.score.toFixed(2)})`);
        }

        return finalResults;
    }
}
