import { App } from "obsidian";
import { GraphService } from "./GraphService";
import { ScoringStrategy } from "./ScoringStrategy";

import { VaultSearchResult } from "../types/search";
import { VaultIntelligenceSettings } from "../settings/types";
import { logger } from "../utils/logger";
import { GraphSearchResult } from "../types/graph";
import { SEARCH_CONSTANTS } from "../constants";

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

        logger.info(`[SearchOrchestrator] Starting GARS-aware search for: "${query}" (Limit: ${limit})`);

        // 1. SEED PHASE: Initial Hybrid Search (Vector + Keyword)
        // RECCO 1: Overshoot the worker limit to ensure we see the "relevance tail"
        const workerLimit = Math.max(limit * 2, this.settings.searchCentralityLimit || SEARCH_CONSTANTS.DEFAULT_CENTRALITY_LIMIT);
        const vectorResults = await this.graphService.search(query, workerLimit);
        const keywordResults = await this.graphService.keywordSearch(query, workerLimit);

        // Map Results to internal VaultSearchResult format
        const vResults: VaultSearchResult[] = vectorResults.map(r => ({
            path: r.path,
            score: r.score,
            isKeywordMatch: false,
            isTitleMatch: false
        }));

        const kResults: VaultSearchResult[] = keywordResults.map(r => ({
            path: r.path,
            score: r.score,
            isKeywordMatch: true,
            isTitleMatch: false
        }));

        const seedHits = this.mergeAndRank(vResults, kResults, workerLimit);

        // 2. EXPANSION PHASE: Graph Traversal
        const candidates = new Map<string, VaultSearchResult>();

        // RECCO 1: Dynamic Expansion Based on score gaps
        const topScore = seedHits[0]?.score || 0;
        const expansionThreshold = topScore * (this.settings.searchExpansionThreshold || SEARCH_CONSTANTS.DEFAULT_EXPANSION_THRESHOLD);

        const expansionSeeds: string[] = [];
        // Hard cap on expansion seeds to prevent worker flood
        const maxSeeds = this.settings.searchExpansionSeedsLimit || SEARCH_CONSTANTS.DEFAULT_EXPANSION_SEEDS_LIMIT;

        for (const hit of seedHits) {
            candidates.set(hit.path, { ...hit });
            // Expand neighbors for anything within the threshold, up to cap, and above absolute floor
            if (hit.score >= expansionThreshold &&
                hit.score >= SEARCH_CONSTANTS.ABSOLUTE_MIN_EXPANSION_SCORE &&
                expansionSeeds.length < maxSeeds) {
                expansionSeeds.push(hit.path);
            }
        }

        // Expand neighbors for top seeds in parallel
        const neighborPromises = expansionSeeds.map(async (path) => {
            const parent = candidates.get(path);
            if (!parent) return;

            // RECCO 2: Dynamic Decay Control
            const neighbors = await this.graphService.getNeighbors(path, {
                mode: 'ontology',
                direction: 'outbound',
                decay: SEARCH_CONSTANTS.NEIGHBOR_DECAY
            });

            return { parent, neighbors };
        });

        const neighborResults = (await Promise.all(neighborPromises)).filter((r): r is { parent: VaultSearchResult; neighbors: GraphSearchResult[] } => r !== undefined);

        for (const { parent, neighbors } of neighborResults) {
            for (const n of neighbors) {
                if (!candidates.has(n.path)) {
                    candidates.set(n.path, {
                        path: n.path,
                        score: 0,
                        isGraphNeighbor: true
                    });
                }

                // Spreading Activation
                const neighbor = candidates.get(n.path)!;
                const activationBoost = parent.score * SEARCH_CONSTANTS.SPREADING_ACTIVATION_WEIGHT;
                neighbor.score = Math.max(neighbor.score, activationBoost);
            }
        }

        // 3. SCORING PHASE: Final GARS Calculation
        // Safety slice for centrality calculation
        const centralityLimit = this.settings.searchCentralityLimit || SEARCH_CONSTANTS.DEFAULT_CENTRALITY_LIMIT;
        const candidatePaths = Array.from(candidates.keys()).slice(0, centralityLimit);
        const centralityMap = await this.graphService.getBatchCentrality(candidatePaths);

        const finalResults: VaultSearchResult[] = [];
        for (const [path, res] of candidates) {
            const centrality = centralityMap[path] || 0;

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
