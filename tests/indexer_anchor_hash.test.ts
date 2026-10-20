import { describe, expect, it } from 'vitest';

import { applyFenceAugmentation, getFenceAugmentation, semanticSplit } from '../src/utils/indexer-utils';
import { fastHash, splitFrontmatter } from '../src/utils/link-parsing';

/**
 * Contract test for the hydration anchor (see ResultHydrator.anchoredAlignment
 * and indexer.worker.ts). anchorHash must be derived from the raw file slice,
 * never from chunk.text, because chunk text can carry synthetic fence lines
 * that exist nowhere in the file. The indexer worker has no in-test harness,
 * so this simulates its chunking and the hydrator's direct-match check against
 * a document with a frontmatter block and an oversized fence.
 */
describe('indexer anchor hash contract', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `code line ${index}`);
    const content = [
        '---',
        'title: Fenced note',
        'tags: [code]',
        '---',
        '# Title',
        '',
        '```python',
        ...lines,
        '```',
        '',
        'Tail text.'
    ].join('\n');
    const { body, bodyOffset } = splitFrontmatter(content);
    const chunks = semanticSplit(body, 150);

    /**
     * Standalone fence pairing: every fence opened by a line of at least three
     * markers must be closed by a matching closer line within the same excerpt.
     */
    const isBalanced = (excerpt: string): boolean => {
        let openChar = '\0';
        let openLength = 0;
        for (const rawLine of excerpt.split('\n')) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            let indent = 0;
            while (indent < 3 && line.charAt(indent) === ' ') indent++;
            const first = line.charAt(indent);
            if (first !== '`' && first !== '~') continue;

            let run = 0;
            while (line.charAt(indent + run) === first) run++;
            if (run < 3) continue;
            if (openChar === '\0') {
                openChar = first;
                openLength = run;
            } else if (first === openChar && run >= openLength) {
                openChar = '\0';
                openLength = 0;
            }
        }
        return openChar === '\0';
    };

    it('produces several chunks and augments the fence interior ones', () => {
        expect(chunks.length).toBeGreaterThan(2);
        expect(chunks.some((chunk) => chunk.fenceAugmented)).toBe(true);
    });

    it('hashes anchors from the raw slice, matching hydration on the full content', () => {
        for (const chunk of chunks) {
            const anchor = fastHash(body.slice(chunk.start, chunk.end));
            const hydrated = fastHash(content.substring(chunk.start + bodyOffset, chunk.end + bodyOffset));
            expect(anchor).toBe(hydrated);
        }
    });

    it('keeps offsets on raw slice bounds while excerpts stay self-balanced', () => {
        for (const chunk of chunks) {
            const augmentation = getFenceAugmentation(body, chunk.start, chunk.end);
            expect(chunk.text).toBe(applyFenceAugmentation(body.slice(chunk.start, chunk.end), augmentation));
            expect(chunk.fenceAugmented).toBe(augmentation.prefix !== '' || augmentation.suffix !== '');
            expect(isBalanced(chunk.text)).toBe(true);
        }
    });
});