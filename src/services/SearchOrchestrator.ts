import { App } from "obsidian";

import { VaultIntelligenceSettings } from "../settings/types";
import { VaultSearchResult } from "../types/search";
import { logger } from "../utils/logger";
import { GeminiService } from "./GeminiService";
import { GraphService } from "./GraphService";
import { IEmbeddingService } from "./IEmbeddingService";
import { ScoringStrategy } from "./ScoringStrategy";

/**
 * Service that orchestrates hybrid search across the vault.
 * Combines vector search results with keyword matching for optimal recall and precision.
 */
export class SearchOrchestrator {
    private app: App;
    private graphService: GraphService;
    private geminiService: GeminiService;
    private embeddingService: IEmbeddingService;
    private settings: VaultIntelligenceSettings;
    private scoringStrategy: ScoringStrategy;

    // FIX: Ensure constructor accepts 5 arguments including embeddingService
    constructor(
        app: App,
        graphService: GraphService,
        geminiService: GeminiService,
        embeddingService: IEmbeddingService,
        settings: VaultIntelligenceSettings
    ) {
        this.app = app;
        this.graphService = graphService;
        this.geminiService = geminiService;
        this.embeddingService = embeddingService;
        this.settings = settings;
        this.scoringStrategy = new ScoringStrategy();
    }

    /**
     * Performs a hybrid search (Vector + Keyword) on the vault.
     * @param query - The user's search query.
     * @param limit - Maximum number of final results to return.
     * @param options - Search options (e.g. deep: false to skip AI reranking).
     * @returns A promise resolving to a ranked list of search results.
     */
    public async search(query: string, limit: number, options: { deep?: boolean } = {}): Promise<VaultSearchResult[]> {
        // DUAL-LOOP LOGIC:
        // If Deep search is requested (or default is enabled), we try the Analyst (Loop 2) first.
        // It provides deeper, graph-expanded, and AI-ranked results.
        const deep = options.deep ?? this.settings.enableDualLoop;

        if (deep) {
            try {
                const analystResults = await this.searchAnalyst(query);
                if (analystResults.length > 0) {
                    return analystResults.slice(0, limit);
                }
                logger.warn("[SearchOrchestrator] Analyst loop returned no results. Falling back to Reflex.");
            } catch (error) {
                logger.error("[SearchOrchestrator] Analyst loop failed. Falling back to Reflex.", error);
            }
        }

        // Fallback or Default: Reflex Loop (Loop 1)
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
            const queryVector = await this.embeddingService.embedQuery(query);

            // 1. Build Payload (Graph + Vector + Keyword)
            const payload = await this.graphService.buildPriorityPayload(queryVector, query);

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

        // We use a Calibration Factor to map unbounded BM25 scores into 0-1 range.
        // A sigmoid-like function: score / (score + K) allows high scores to approach 1.0 
        // without capping, preserving ranking granularity.
        const K = this.settings.keywordWeight;

        for (const res of keywordResults) {
            const existing = mergedMap.get(res.path);
            const normalizedKeywordScore = res.score / (res.score + K);

            if (existing !== undefined) {
                // Blend scores. We give vector results slightly more weight by dividing by 1.5.
                existing.score = (existing.score + normalizedKeywordScore) / 1.5;
                existing.isKeywordMatch = true;
            } else {
                mergedMap.set(res.path, { ...res, score: normalizedKeywordScore });
            }
        }

        const minScore = this.settings.minSimilarityScore;

        const finalResults = Array.from(mergedMap.values())
            .filter(r => r.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return finalResults;
    }
}