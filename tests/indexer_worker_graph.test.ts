import { describe, expect, it } from "vitest";

import { computeCentroid } from "../src/utils/indexer-utils";

describe('IndexerWorker Graph Operations: computeCentroid', () => {
    it('should return undefined for empty arrays', () => {
        expect(computeCentroid([])).toBeUndefined();
    });

    it('should compute the exact centroid of vectors', () => {
        const vectors = [
            [1.0, 2.0, 3.0],
            [3.0, 0.0, 1.0],
            [2.0, 4.0, 2.0]
        ];
        // Average:
        // Index 0: (1+3+2)/3 = 2
        // Index 1: (2+0+4)/3 = 2
        // Index 2: (3+1+2)/3 = 2
        const result = computeCentroid(vectors);
        expect(result).toEqual([2.0, 2.0, 2.0]);
    });

    it('should handle zero-vectors properly', () => {
        const vectors = [
            [0, 0, 0],
            [0, 0, 0]
        ];
        const result = computeCentroid(vectors);
        expect(result).toEqual([0, 0, 0]);
    });
});
