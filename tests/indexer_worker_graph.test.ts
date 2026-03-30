import Graph from "graphology";
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

function mockFindOrphanCandidates(graph: Graph, ontologyPrefix: string, gracePeriodMs: number, now: number): string[] {
    const prefix = (ontologyPrefix.startsWith('/') ? ontologyPrefix.substring(1) : ontologyPrefix).toLowerCase();
    const candidates: string[] = [];

    graph.forEachNode((node, attr) => {
        if (attr.type !== 'file') return;
        if (!node.startsWith(prefix + '/')) return;
        
        const parts = node.split('/');
        if (parts.length >= 2) {
            const folderName = parts[parts.length - 2];
            const fileName = parts[parts.length - 1];
            if (folderName && fileName === folderName + '.md') {
                return;
            }
        }

        if (graph.inDegree(node) > 0) return;
        if (gracePeriodMs > 0 && (now - attr.mtime) < gracePeriodMs) return;

        candidates.push(node);
    });

    return candidates;
}

describe('IndexerWorker Graph Operations: findOrphanCandidates', () => {
    it('should find 0 in-degree nodes in ontology folder', () => {
        const graph = new Graph();
        graph.addNode('ontology/concept_a.md', { mtime: 1000, type: 'file' });
        graph.addNode('ontology/concept_b.md', { mtime: 1000, type: 'file' });
        
        // A links to B (B has inDegree 1, A has inDegree 0)
        graph.addEdge('ontology/concept_a.md', 'ontology/concept_b.md');
        
        const candidates = mockFindOrphanCandidates(graph, 'ontology', 0, 2000);
        expect(candidates).toEqual(['ontology/concept_a.md']);
    });

    it('should exclude non-file nodes', () => {
        const graph = new Graph();
        graph.addNode('ontology/concept_a.md', { mtime: 1000, type: 'topic' });
        
        const candidates = mockFindOrphanCandidates(graph, 'ontology', 0, 2000);
        expect(candidates).toEqual([]);
    });

    it('should exclude files outside ontology folder', () => {
        const graph = new Graph();
        graph.addNode('other/concept_a.md', { mtime: 1000, type: 'file' });
        
        const candidates = mockFindOrphanCandidates(graph, 'ontology', 0, 2000);
        expect(candidates).toEqual([]);
    });

    it('should exclude index files', () => {
        const graph = new Graph();
        graph.addNode('ontology/projects/projects.md', { mtime: 1000, type: 'file' }); // Index file
        graph.addNode('ontology/projects/apollo.md', { mtime: 1000, type: 'file' }); // Regular file
        
        const candidates = mockFindOrphanCandidates(graph, 'ontology', 0, 2000);
        expect(candidates).toEqual(['ontology/projects/apollo.md']);
    });

    it('should obey grace period', () => {
        const graph = new Graph();
        graph.addNode('ontology/old.md', { mtime: 1000, type: 'file' });
        graph.addNode('ontology/new.md', { mtime: 5000, type: 'file' });
        
        // Current time is 6000, grace period is 2000
        // old.md age is 5000 > 2000 (included)
        // new.md age is 1000 < 2000 (excluded)
        const candidates = mockFindOrphanCandidates(graph, 'ontology', 2000, 6000);
        expect(candidates).toEqual(['ontology/old.md']);
    });
});

