
export interface VaultSearchResult {
    excerpt?: string;
    isGraphNeighbor?: boolean;
    isKeywordMatch?: boolean;
    isTitleMatch?: boolean;
    path: string;
    score: number;
    tokenCount?: number;
}
