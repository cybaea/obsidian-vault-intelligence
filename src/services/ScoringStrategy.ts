import { SEARCH_CONSTANTS } from "../constants";

export interface ScoringResult {
    isKeywordMatch: boolean;
    isTitleMatch: boolean;
    score: number;
}

/**
 * Encapsulates the heuristic scoring logic for search results.
 * Isolated for better testability and maintenance.
 */
export class ScoringStrategy {

    /**
     * Calculates a score based on title match.
     */
    public calculateTitleScore(titleLower: string, queryLower: string): number | null {
        if (titleLower.includes(queryLower)) {
            return SEARCH_CONSTANTS.SCORE_TITLE_MATCH;
        }
        return null;
    }

    /**
     * Calculates a score based on exact body match.
     */
    public calculateExactBodyScore(contentLower: string, queryLower: string): number | null {
        if (contentLower.includes(queryLower)) {
            return SEARCH_CONSTANTS.SCORE_BODY_MATCH;
        }
        return null;
    }

    /**
     * Adaptive Fuzzy Scoring (Bag of Words)
     * Handles short queries (strict) vs long queries (loose/synonym stuffing).
     */
    public calculateFuzzyScore(tokens: string[], contentLower: string): number {
        let hits = 0;
        for (const token of tokens) {
            // Stemming checks (simplified)
            let match = false;
            if (contentLower.includes(token)) {
                match = true;
            } else if (token.endsWith('s') && contentLower.includes(token.slice(0, -1))) {
                match = true;
            } else if (token.endsWith('ing') && contentLower.includes(token.slice(0, -3))) {
                match = true;
            } else if (token.endsWith('ed') && contentLower.includes(token.slice(0, -2))) {
                match = true;
            }

            if (match) hits++;
        }

        const matchRatio = hits / tokens.length;
        let fuzzyScore = 0;

        // Scenario 1: Short Query (< FUZZY_LONG_QUERY_THRESHOLD tokens) -> Strict (Need high overlap)
        if (tokens.length < SEARCH_CONSTANTS.FUZZY_LONG_QUERY_THRESHOLD) {
            if (matchRatio > SEARCH_CONSTANTS.FUZZY_SHORT_THRESHOLD) {
                // Heuristic: boost short query by a constant factor for high match ratios
                const SHORT_QUERY_BOOST_FACTOR = 0.3;
                fuzzyScore = SEARCH_CONSTANTS.FUZZY_SHORT_BASE_SCORE + (matchRatio * SHORT_QUERY_BOOST_FACTOR);
            }
        }
        // Scenario 2: Long Query (>= FUZZY_LONG_QUERY_THRESHOLD tokens) -> Loose (Synonym stuffing)
        else {
            if (hits >= SEARCH_CONSTANTS.FUZZY_MIN_HITS_FOR_LONG_QUERY || matchRatio > SEARCH_CONSTANTS.FUZZY_LONG_THRESHOLD) {
                // Score based on raw hit count
                fuzzyScore = Math.min(
                    SEARCH_CONSTANTS.FUZZY_SHORT_BASE_SCORE + (hits * SEARCH_CONSTANTS.FUZZY_LONG_HIT_MULTIPLIER),
                    SEARCH_CONSTANTS.FUZZY_SCORE_CAP
                );
            }
        }

        return fuzzyScore;
    }

    public boostHybridResult(vectorScore: number, keywordMatch?: ScoringResult): number {
        let score = vectorScore;
        if (keywordMatch) {
            score += SEARCH_CONSTANTS.HYBRID_BOOST_SCORE;
            if (keywordMatch.isTitleMatch) {
                score += SEARCH_CONSTANTS.HYBRID_TITLE_BOOST;
            }
        }
        return score;
    }

    /**
     * Calculates the final Graph-Aware Relevance Score (GARS).
     */
    public calculateGARS(similarity: number, centrality: number, activation: number, weights: { similarity: number, centrality: number, activation: number }): number {
        return (similarity * weights.similarity) + (centrality * weights.centrality) + (activation * weights.activation);
    }
}
