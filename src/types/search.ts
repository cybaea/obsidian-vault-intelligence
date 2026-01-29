
export interface VaultSearchResult {
    isGraphNeighbor?: boolean;
    isKeywordMatch?: boolean;
    isTitleMatch?: boolean;
    path: string;
    score: number;
}
