import { describe, it, expect } from 'vitest';

// Simulating the logic from GardenerService.ts
function mergePaths(root: string, suggested: string): string {
    const normalize = (p: string) => p.replace(/\/+$/, '').replace(/^\/+/, '');
    const rootPath = normalize(root);
    const suggestedPath = normalize(suggested);

    const rootSegments = rootPath.split('/').filter(Boolean);
    const suggestedSegments = suggestedPath.split('/').filter(Boolean);

    // Find the longest suffix of root that is a prefix of suggested
    let overlapCount = 0;
    for (let i = 1; i <= Math.min(rootSegments.length, suggestedSegments.length); i++) {
        const rootSuffix = rootSegments.slice(-i);
        const suggestedPrefix = suggestedSegments.slice(0, i);
        if (rootSuffix.every((seg, idx) => seg.toLowerCase() === suggestedPrefix[idx]?.toLowerCase())) {
            overlapCount = i;
        }
    }

    let finalPath: string;
    if (overlapCount > 0) {
        // Suggested starts with a suffix of root, so we prepend only the unique part of root
        const uniqueRoot = rootSegments.slice(0, rootSegments.length - overlapCount);
        const overlapFromRoot = rootSegments.slice(-overlapCount);
        const uniqueSuggested = suggestedSegments.slice(overlapCount);
        finalPath = [...uniqueRoot, ...overlapFromRoot, ...uniqueSuggested].join('/');
    } else {
        // No overlap, prepend the whole root
        finalPath = [...rootSegments, ...suggestedSegments].join('/');
    }
    
    return finalPath;
}

describe('Gardener Path Merging Logic', () => {
    it('should correctly merge nested ontology paths', () => {
        const root = 'Work/Ontology';
        const suggested = 'Ontology/Topics/New topic.md';
        // Current buggy behavior would produce: Work/Ontology/Ontology/Topics/New topic.md
        // Expected: Work/Ontology/Topics/New topic.md
        expect(mergePaths(root, suggested)).toBe('Work/Ontology/Topics/New topic.md');
    });

    it('should handle simple root and relative suggested path', () => {
        const root = 'Ontology';
        const suggested = 'Topics/New topic.md';
        expect(mergePaths(root, suggested)).toBe('Ontology/Topics/New topic.md');
    });

    it('should handle simple root and absolute suggested path', () => {
        const root = 'Ontology';
        const suggested = 'Ontology/Topics/New topic.md';
        expect(mergePaths(root, suggested)).toBe('Ontology/Topics/New topic.md');
    });

    it('should handle deep root and suggested path with overlap', () => {
        const root = 'Archive/2026/Ontology';
        const suggested = 'Ontology/Entities/Person.md';
        expect(mergePaths(root, suggested)).toBe('Archive/2026/Ontology/Entities/Person.md');
    });

    it('should handle deep root and suggested path with multiple overlaps', () => {
        const root = 'Work/Projects/Ontology';
        const suggested = 'Projects/Ontology/Topics/ProjectA.md';
        expect(mergePaths(root, suggested)).toBe('Work/Projects/Ontology/Topics/ProjectA.md');
    });

    it('should handle full overlap', () => {
        const root = 'Work/Ontology';
        const suggested = 'Work/Ontology/Topics/New.md';
        expect(mergePaths(root, suggested)).toBe('Work/Ontology/Topics/New.md');
    });
    
    it('should handle case insensitivity', () => {
        const root = 'Work/Ontology';
        const suggested = 'ontology/Topics/New.md';
        expect(mergePaths(root, suggested)).toBe('Work/Ontology/Topics/New.md');
    });
});
