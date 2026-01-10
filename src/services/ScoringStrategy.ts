import { SEARCH_CONSTANTS } from "../constants";

export interface ScoringResult {
    score: number;
    isKeywordMatch: boolean;
    isTitleMatch: boolean;
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

        // Scenario 1: Short Query (< 4 tokens) -> Strict (Need high overlap)
        if (tokens.length < 4) {
            if (matchRatio > SEARCH_CONSTANTS.FUZZY_SHORT_THRESHOLD) {
                fuzzyScore = SEARCH_CONSTANTS.FUZZY_SHORT_BASE_SCORE + (matchRatio * 0.3); // 0.3 factor is kept as-is for now
            }
        }
        // Scenario 2: Long Query (>= 4 tokens) -> Loose (Synonym stuffing)
        else {
            if (hits >= 2 || matchRatio > SEARCH_CONSTANTS.FUZZY_LONG_THRESHOLD) {
                // Score based on raw hit count
                fuzzyScore = Math.min(
                    SEARCH_CONSTANTS.FUZZY_SHORT_BASE_SCORE + (hits * SEARCH_CONSTANTS.FUZZY_LONG_HIT_MULTIPLIER),
                    SEARCH_CONSTANTS.FUZZY_SCORE_CAP
                );
            }
        }

        return fuzzyScore;
    }

    /**
     * Merges Vector and Keyword results, applying boosts.
     */
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
}
