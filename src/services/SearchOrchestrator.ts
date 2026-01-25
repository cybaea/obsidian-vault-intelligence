import { App } from "obsidian";
import { GraphService } from "./GraphService";
import { ScoringStrategy } from "./ScoringStrategy";

import { SEARCH_CONSTANTS } from "../constants";
import { VaultSearchResult } from "../types/search";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";

/**
 * Service that orchestrates hybrid search across the vault.
 * Combines vector search results with keyword matching for optimal recall and precision.
 */
export class SearchOrchestrator {
    private app: App;
    private graphService: GraphService;
    private scoringStrategy: ScoringStrategy;
    private settings: VaultIntelligenceSettings;

    constructor(app: App, graphService: GraphService, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.graphService = graphService;
        this.settings = settings;
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

        logger.info(`[SearchOrchestrator] Starting GARS-aware search for: "${query}"`);

        // 1. SEED PHASE: Initial Hybrid Search (Vector + Keyword)
        // We fetch slightly more than limit to allow for graph-based reshuffling
        const seedLimit = limit * 2;
        const vectorResults = await this.graphService.search(query, seedLimit);
        const keywordResults = await this.performKeywordSearch(query);
        const seedHits = this.mergeAndRank(vectorResults, keywordResults, seedLimit);

        // 2. EXPANSION PHASE: Graph Traversal
        const candidates = new Map<string, VaultSearchResult>();
        const seedPaths: string[] = [];

        for (const hit of seedHits) {
            candidates.set(hit.path, { ...hit });
            seedPaths.push(hit.path);
        }

        // Expand neighbors for top seeds
        // (Limit expansion to top 10 seeds to avoid excessive worker calls)
        const topSeeds = seedPaths.slice(0, 10);
        for (const path of topSeeds) {
            const parent = candidates.get(path);
            if (!parent) continue;

            const neighbors = await this.graphService.getNeighbors(path, {
                mode: 'ontology',
                direction: 'outbound' // We want to navigate FROM the seed TO its topics/neighbors
                // Wait, if we use 'ontology' mode, the worker handles the specific 2-hop logic (1-hop outbound -> filter topics -> 1-hop inbound)
                // The worker's getNeighbors logic for 'ontology' mode does:
                // 1. Get initial neighbors based on options.direction (default both)
                // 2. Filter topics
                // 3. Get inbound neighbors of topics

                // So if we pass direction: 'outbound', the worker will get Outbound neighbors (Topics) of the Seed.
                // Then for each Topic, it gets Inbound neighbors (Siblings).
                // This matches the "Sibling" requirement perfectly.
            });
            for (const n of neighbors) {
                if (!candidates.has(n.path)) {
                    candidates.set(n.path, {
                        path: n.path,
                        score: 0,
                        isGraphNeighbor: true
                    });
                }

                // Spreading Activation (Implicit)
                // If a neighbor is found, it inherits a portion of the parent's score as activation
                const neighbor = candidates.get(n.path)!;
                const activationBoost = parent.score * 0.5; // Constant decay factor
                neighbor.score = Math.max(neighbor.score, activationBoost);
            }
        }

        // 3. SCORING PHASE: Final GARS Calculation
        const finalResults: VaultSearchResult[] = [];
        for (const [path, res] of candidates) {
            const { centrality } = await this.graphService.getNodeMetrics(path);

            // GARS components:
            // Similarity: the original hybrid score (0 for pure neighbors)
            // Activation: the boosted score from spreading (0 for seed hits)
            const similarity = res.isGraphNeighbor ? 0 : res.score;
            const activation = res.isGraphNeighbor ? res.score : 0;

            res.score = this.scoringStrategy.calculateGARS(similarity, centrality, activation, {
                similarity: this.settings.garsSimilarityWeight,
                centrality: this.settings.garsCentralityWeight,
                activation: this.settings.garsActivationWeight
            });
            finalResults.push(res);
        }

        const sortedResults = finalResults
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.info(`[SearchOrchestrator] GARS-ranked results: ${sortedResults.length} docs.`);
        if (sortedResults[0]) {
            logger.info(`[SearchOrchestrator] Top match: ${sortedResults[0].path} (GARS: ${sortedResults[0].score.toFixed(2)})`);
        }

        return sortedResults;
    }

    /**
     * Performs a keyword search across the title and content of markdown files.
     * @param query - The user's search query.
     * @returns A promise resolving to an array of keyword matches.
     * @private
     */
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

    /**
     * Merges vector-based results with keyword-based results, applying boosts where they overlap.
     * @param vectorResults - Results from the vector search.
     * @param keywordResults - Results from the keyword search.
     * @param limit - Maximum number of results to return after merging.
     * @returns Array of merged and ranked search results.
     * @private
     */
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
