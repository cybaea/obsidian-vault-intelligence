
export interface VaultSearchResult {
    path: string;
    score: number;
    isKeywordMatch?: boolean;
    isTitleMatch?: boolean;
    isGraphNeighbor?: boolean;
}
