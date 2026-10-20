import { expect, test, describe } from 'vitest';

import { stripStopWords, semanticSplit, calculateInheritedScore, estimateTokens, recursiveCharacterSplitter, sanitizeProperty, ensureArray, sanitizeExcalidrawContent, extractHeaders, parseYaml, findCodeFenceIntervals, splitWithOffsets } from '../../src/utils/indexer-utils';

describe('indexer-utils', () => {

    describe('stripStopWords', () => {
        test('removes stop words', () => {
            const stopwords = ['the', 'a', 'an'];
            expect(stripStopWords('the quick brown fox used a tool', stopwords)).toBe('quick brown fox used tool');
        });

        test('returns original query if stopwords are empty', () => {
            expect(stripStopWords('the quick brown fox', [])).toBe('the quick brown fox');
        });

        test('returns original query if everything is stripped', () => {
            const stopwords = ['the', 'quick'];
            expect(stripStopWords('the quick', stopwords)).toBe('the quick');
        });
    });

    describe('calculateInheritedScore', () => {
        test('calculates correctly based on dilution', () => {
            // Dilution for 0 links should be Math.max(1, Math.log2(1)) = 1
            expect(calculateInheritedScore(1.0, 0)).toBeCloseTo(0.8);
            
            // Dilution for 1 link = Math.log2(2) = 1
            expect(calculateInheritedScore(1.0, 1)).toBeCloseTo(0.8);

            // Dilution for 3 links = Math.log2(4) = 2
            expect(calculateInheritedScore(1.0, 3)).toBeCloseTo(0.4);
        });
    });

    describe('estimateTokens', () => {
        test('estimates token count based on string length', () => {
            expect(estimateTokens('1234')).toBe(1); // 4 / 4 = 1
            expect(estimateTokens('12345678')).toBe(2);
        });

        test('respects custom charsPerToken ratio', () => {
            // CJK languages: ~2 chars/token
            expect(estimateTokens('1234', 2)).toBe(2); // 4 / 2 = 2
            expect(estimateTokens('12345678', 2)).toBe(4); // 8 / 2 = 4
            // Code-heavy: ~3 chars/token
            expect(estimateTokens('123456', 3)).toBe(2); // 6 / 3 = 2
        });
    });

    describe('sanitizeProperty', () => {
        test('sanitizes wikilinks', () => {
            expect(sanitizeProperty('[[Document|Doc]]')).toBe('Doc');
            expect(sanitizeProperty('[[SimpleLink]]')).toBe('SimpleLink');
        });

        test('removes quotes', () => {
            expect(sanitizeProperty('"Quoted"')).toBe('Quoted');
            expect(sanitizeProperty("'Single'")).toBe('Single');
        });

        test('handles arrays by flattening and sanitizing', () => {
            expect(sanitizeProperty(['[[Doc]]', '"Tag"'])).toBe('Doc, Tag');
        });

        test('handles non-strings gracefully', () => {
            expect(sanitizeProperty(123)).toBe('123');
            expect(sanitizeProperty(null)).toBe('null');
        });
    });

    describe('ensureArray', () => {
        test('converts non-arrays to arrays', () => {
            expect(ensureArray('test')).toEqual(['test']);
        });

        test('leaves arrays untouched', () => {
            expect(ensureArray(['test'])).toEqual(['test']);
        });

        test('returns empty array for falsy values', () => {
            expect(ensureArray(undefined)).toEqual([]);
            expect(ensureArray(null)).toEqual([]);
            expect(ensureArray('')).toEqual([]);
        });
    });

    describe('sanitizeExcalidrawContent', () => {
        test('removes compressed json blocks', () => {
            const content = 'Hello\n```compressed-json\n{ "data": 1 }\n```\nWorld';
            expect(sanitizeExcalidrawContent(content)).toBe('Hello\n\nWorld');
        });

        test('leaves normal content untouched', () => {
            expect(sanitizeExcalidrawContent('Hello World')).toBe('Hello World');
        });
    });

    describe('extractHeaders', () => {
        test('extracts standard headers', () => {
            const content = '# Header 1\nSome text\n## Header 2\n### Header 3';
            expect(extractHeaders(content)).toEqual(['# Header 1', '## Header 2', '### Header 3']);
        });

        test('ignores non-headers or deeper headers', () => {
            const content = '#### Header 4\nJust text # not a header';
            expect(extractHeaders(content)).toEqual([]);
        });
    });

    describe('parseYaml', () => {
        test('parses basic key value', () => {
            const yaml = '---\ntitle: Hello\ntags: [a, b]\n---';
            const res = parseYaml(yaml);
            expect(res).toEqual({ tags: ['a', 'b'], title: 'Hello' });
        });

        test('parses list items', () => {
            const yaml = '---\naliases:\n  - Alias 1\n  - Alias 2\n---';
            const res = parseYaml(yaml);
            expect(res).toEqual({ aliases: ['Alias 1', 'Alias 2'] });
        });
    });

    describe('recursiveCharacterSplitter', () => {
        test('splits large text gracefully', () => {
            const text = 'A'.repeat(50) + '\n\n' + 'B'.repeat(50);
            const chunks = recursiveCharacterSplitter(text, 60, 10);
            expect(chunks.length).toBe(3);
            expect(chunks[0]).toContain('A'.repeat(50));
            expect(chunks[1]).toContain('B'.repeat(48));
            expect(chunks[2]).toBe('BB');
        });

        test('returns single chunk if small enough', () => {
            const chunks = recursiveCharacterSplitter('Short text', 100, 10);
            expect(chunks).toEqual(['Short text']);
        });
    });

    describe('semanticSplit', () => {
        test('splits text based on headers without destroying content', () => {
            const text = '# Intro\nSome intro.\n## Part 1\nMore text.';
            const chunks = semanticSplit(text, 50);
            
            // Depending on length, it might split into two chunks or remain one
            // We pass maxChunkSize=50, total length is ~40, so it fits in 1 chunk
            expect(chunks.length).toBe(1);
            expect(chunks[0]?.text).toBe(text);
        });

        test('forcefully splits if maxChunkSize is tiny', () => {
            const text = '# Intro\nSome intro.\n## Part 1\nMore text.';
            const chunks = semanticSplit(text, 10);
            expect(chunks.length).toBeGreaterThan(1);
        });
    });

    describe('code fence awareness', () => {
        const assertOffsetsMatchSource = (source: string, chunks: ReturnType<typeof semanticSplit>): void => {
            for (const chunk of chunks) {
                expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
            }
        };

        test('keeps header-like comments inside a fitting fence intact', () => {
            const text = '# Setup\nIntro line.\n```python\n# a comment\nvalue = 1\n# another comment\n```\n# Usage\nRun the script.';
            const chunks = semanticSplit(text, 500);

            expect(chunks).toHaveLength(1);
            assertOffsetsMatchSource(text, chunks);
        });

        test('treats an unclosed fence as code until the end of the note', () => {
            const text = '# Title\n```bash\n# not a header\n# Setup\nmore code';
            const chunks = semanticSplit(text, 100);

            expect(chunks).toHaveLength(1);
            expect(chunks[0]?.text).toBe(text);
            assertOffsetsMatchSource(text, chunks);
        });

        test('does not treat header-like lines inside tilde fences as headers', () => {
            const text = '~~~\n# not a header\n~~~\n# Real Header\nBody text.';
            const chunks = semanticSplit(text, 500);

            expect(chunks).toHaveLength(2);
            expect(chunks[1]?.text.startsWith('# Real Header')).toBe(true);
            assertOffsetsMatchSource(text, chunks);
        });

        test('honours up to three leading spaces of fence indentation', () => {
            const fence = '   ```python\n# fenced comment\n   ```';
            const text = `# Title\n${fence}\n${'z'.repeat(60)}\n# Real Header\nBody.`;
            const chunks = semanticSplit(text, 40);
            const [interval] = findCodeFenceIntervals(text);

            assertOffsetsMatchSource(text, chunks);
            expect(chunks).toHaveLength(5);
            if (interval !== undefined) {
                const intact = chunks.some((chunk) => chunk.start <= interval.start && chunk.end >= interval.end);
                expect(intact).toBe(true);
            }
        });

        test('keeps a fitting fence whole when oversized sections split around it', () => {
            const fence = '```python\n' + ['# c1', '# c2', '# c3', '# c4', '# c5', '# c6', '# c7', '# c8'].join('\n') + '\n```';
            const text = `# Setup\nIntro.\n${fence}\n# Usage\n${'z'.repeat(60)}`;
            const chunks = semanticSplit(text, 60);
            const fenceStart = text.indexOf(fence);
            const fenceEnd = fenceStart + fence.length;

            assertOffsetsMatchSource(text, chunks);
            expect(chunks.some((chunk) => chunk.start <= fenceStart && chunk.end >= fenceEnd)).toBe(true);
        });

        test('keeps a four-backtick fence with an inner triple-backtick block whole', () => {
            const fence = '````markdown\n```python\n# inner comment\n```\n````';
            const text = `# Notes\n${'x'.repeat(70)}\n${fence}\n# Next\nTail.`;
            const chunks = semanticSplit(text, 80);
            const fenceStart = text.indexOf(fence);
            const fenceEnd = fenceStart + fence.length;

            assertOffsetsMatchSource(text, chunks);
            expect(chunks).toHaveLength(3);
            expect(chunks.some((chunk) => chunk.start <= fenceStart && chunk.end >= fenceEnd)).toBe(true);
        });

        test('never cuts a fitting fence even across blank lines inside it', () => {
            const para = 'p'.repeat(150);
            const fence = '```py\nline one\n\nline two after a blank\n```';
            const text = `# H\n\n${para}\n\n${fence}\n\ntail`;
            const chunks = semanticSplit(text, 200);
            const fenceStart = text.indexOf(fence);
            const fenceEnd = fenceStart + fence.length;

            assertOffsetsMatchSource(text, chunks);
            expect(chunks.some((chunk) => chunk.start <= fenceStart && chunk.end >= fenceEnd)).toBe(true);
        });

        test('splits an oversized fence at line boundaries with byte-exact slices', () => {
            const lines = Array.from({ length: 24 }, (_, index) => `code line ${index}`);
            const text = `# Title\n\n\`\`\`python\n${lines.join('\n')}\n\`\`\`\n\nTail text.`;
            const chunks = semanticSplit(text, 150);
            const sorted = [...chunks].sort((a, b) => a.start - b.start);

            assertOffsetsMatchSource(text, sorted);
            expect(sorted[0]?.start).toBe(0);
            expect(sorted[sorted.length - 1]?.end).toBe(text.length);
            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1];
                const current = sorted[i];
                if (prev === undefined || current === undefined) continue;
                expect(current.start).toBeGreaterThanOrEqual(prev.start);
                expect(current.start).toBeLessThanOrEqual(prev.end);
            }
            for (const chunk of sorted) {
                const endsAtLineEnd = text.charAt(chunk.end) === '\n' || chunk.end === text.length;
                expect(endsAtLineEnd).toBe(true);
            }
        });

        test('hard-slices gigantic single lines without breaking offset parity', () => {
            const text = `# T\n\n${'y'.repeat(500)}\n\n# End\nTail.`;
            const chunks = semanticSplit(text, 200);

            assertOffsetsMatchSource(text, chunks);
            expect(chunks.length).toBeGreaterThan(2);
            for (const chunk of chunks) {
                expect(chunk.end - chunk.start <= 200).toBe(true);
            }
        });

        test('preserves byte-exact offsets and fence integrity in CRLF documents', () => {
            const fence = '```python\n# a comment\nvalue = 1\n```';
            const text = ('# Setup\nIntro.\n' + fence + '\n# Usage\nRun it.').replace(/\n/g, '\r\n');
            const crlfFence = fence.replace(/\n/g, '\r\n');
            const chunks = semanticSplit(text, 50);
            const fenceStart = text.indexOf(crlfFence);
            const fenceEnd = fenceStart + crlfFence.length;

            assertOffsetsMatchSource(text, chunks);
            expect(chunks).toHaveLength(3);
            expect(chunks.some((chunk) => chunk.start <= fenceStart && chunk.end >= fenceEnd)).toBe(true);
        });

        test('treats a note whose only header-like lines are inside a fence as one chunk', () => {
            const text = '```python\n# Section A\nvalue = 1\n# Section B\nfor i in range(3):\n    print(i)\n```';
            const chunks = semanticSplit(text, 500);

            expect(chunks).toHaveLength(1);
            expect(chunks[0]?.text).toBe(text);
            assertOffsetsMatchSource(text, chunks);
        });

        test('gives a fitting fence its own chunk right after a hard-slice reset', () => {
            const fence = '```py\n' + ('# bb\n'.repeat(8)).trimEnd() + '\n```';
            const text = `# T\n${'y'.repeat(200)}\n${'w'.repeat(50)}\n${fence}\nz`;
            const chunks = semanticSplit(text, 50);

            assertOffsetsMatchSource(text, chunks);
            const interval = findCodeFenceIntervals(text)[0];
            if (interval !== undefined) {
                const intact = chunks.some((chunk) => chunk.start <= interval.start && chunk.end >= interval.end);
                expect(intact).toBe(true);
            }
        });

        test('carry overlap keeps chunks as literal slices', () => {
            const text = 'A'.repeat(60) + '\n\n' + 'B'.repeat(60) + '\n\n' + 'C'.repeat(60);
            const spans = splitWithOffsets(text, 100, 10);

            expect(spans.map((span) => span.start)).toEqual([0, 50, 112]);
            expect(spans.map((span) => span.end)).toEqual([60, 122, 184]);
            assertOffsetsMatchSource(text, spans);
        });
    });

    describe('findCodeFenceIntervals', () => {
        test('covers the closing fence even with trailing spaces', () => {
            const text = '~~~\ncode\n~~~   \n# Later Header';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([{ end: 16, start: 0 }]);
        });

        test('accepts a closer that is longer than the opener', () => {
            const text = '```\ncode\n````  \nafter';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([{ end: 16, start: 0 }]);
        });

        test('treats an unclosed fence as reaching end of file', () => {
            const text = 'intro\n```python\nprint(1)\n# nope\nstill code';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([{ end: text.length, start: 6 }]);
        });

        test('rejects a backtick-fence opener whose info string contains a backtick', () => {
            const text = '```a`b\nplain\n# Header\n';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([]);
        });

        test('does not close a four-backtick fence on an inner triple-backtick line', () => {
            const text = '````md\n```py\n# inner\n```\n````\n# H';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([{ end: 30, start: 0 }]);
        });

        test('keeps CRLF fence offsets byte exact', () => {
            const text = '```py\r\ncode\r\n```\r\nafter';
            const intervals = findCodeFenceIntervals(text);

            expect(intervals).toEqual([{ end: 18, start: 0 }]);
            expect(text.slice(0, 18)).toBe('```py\r\ncode\r\n```\r\n');
        });
    });

    describe('splitWithOffsets', () => {
        test('matches the historic fenceless splitter output byte for byte', () => {
            const text = 'A'.repeat(50) + '\n\n' + 'B'.repeat(50);
            const spans = splitWithOffsets(text, 60, 10);

            expect(spans.map((span) => span.text)).toEqual(['A'.repeat(50), 'A'.repeat(10) + '\n\n' + 'B'.repeat(48), 'BB']);
            expect(spans.map((span) => span.start)).toEqual([0, 40, 100]);
            expect(spans.map((span) => span.end)).toEqual([50, 100, 102]);
        });

        test('zero overlap carries the whole previous chunk like the historic slice(-0)', () => {
            const text = 'AAAA\n\nBBBB\n\nCCCC';
            const spans = splitWithOffsets(text, 4, 0);

            expect(spans.map((span) => span.text)).toEqual(['AAAA', 'AAAA', '\n\nBB', 'BB', 'CCCC']);
            expect(spans.map((span) => span.start)).toEqual([0, 0, 4, 8, 12]);
            expect(spans.map((span) => span.end)).toEqual([4, 4, 8, 10, 16]);
        });
    });

});
