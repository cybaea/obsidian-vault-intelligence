import { App } from "obsidian";

import { VaultIntelligenceSettings } from "../settings/types";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { GeminiService } from "./GeminiService";
import { GraphService } from "./GraphService";
import { ScoringStrategy } from "./ScoringStrategy";

/**
 * Service that orchestrates hybrid search across the vault.
 * Combines vector search results with keyword matching for optimal recall and precision.
 */
export class SearchOrchestrator {
    private app: App;
    private graphService: GraphService;
    private geminiService: GeminiService;
    private settings: VaultIntelligenceSettings;
    private scoringStrategy: ScoringStrategy;

    constructor(app: App, graphService: GraphService, geminiService: GeminiService, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.graphService = graphService;
        this.geminiService = geminiService;
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
        // For backward compatibility and immediate UI feedback (Reflex Loop)
        return this.searchReflex(query, limit);
    }

    /**
     * DUAL-LOOP: Loop 1 (Reflex)
     * Fast, local, parameter-free search.
     */
    public async searchReflex(query: string, limit: number): Promise<VaultSearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        logger.info(`[SearchOrchestrator] Reflex Search: "${query}"`);

        const workerLimit = Math.max(limit * 2, 50);
        const vectorResults = await this.graphService.search(query, workerLimit);
        const keywordResults = await this.graphService.keywordSearch(query, workerLimit);

        const vResults: VaultSearchResult[] = vectorResults.map(r => ({
            excerpt: r.excerpt,
            isKeywordMatch: false,
            isTitleMatch: false,
            path: r.path,
            score: r.score
        }));

        const kResults: VaultSearchResult[] = keywordResults.map(r => ({
            excerpt: r.excerpt,
            isKeywordMatch: true,
            isTitleMatch: false,
            path: r.path,
            score: r.score
        }));

        const merged = this.mergeAndRank(vResults, kResults, limit);
        return merged;
    }

    /**
     * DUAL-LOOP: Loop 2 (Analyst)
     * Deep, AI-driven re-ranking.
     */
    public async searchAnalyst(query: string): Promise<VaultSearchResult[]> {
        logger.info(`[SearchOrchestrator] Analyst Search: "${query}"`);

        if (this.settings.enableDualLoop) {
            // Dual-Loop: Reflex (Loop 1) is handled by UI. This is Analyst (Loop 2).
            const queryVector = await this.geminiService.embedText(query, { taskType: "RETRIEVAL_QUERY" });

            // 1. Build Payload (Graph + Vector)
            const payload = await this.graphService.buildPriorityPayload(queryVector);

            // 2. Re-Rank (Gemini 3)
            const reranked = await this.geminiService.reRank(query, payload);

            // 3. Map to VaultSearchResult
            return reranked.map((item: unknown) => {
                const r = item as { id: string, score: number, reasoning: string };
                return {
                    content: r.reasoning,
                    path: r.id.split('#')[0], // Simple path extraction
                    score: r.score,
                } as VaultSearchResult;
            });
        }
        return []; // Return empty if dual loop is not enabled
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
                // Simplified boosting logic for Reflex
                existing.score = (existing.score + res.score) / 1.5; // Simple blend
                existing.isKeywordMatch = true;
            } else {
                mergedMap.set(res.path, res);
            }
        }

        const finalResults = Array.from(mergedMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return finalResults;
    }
}
