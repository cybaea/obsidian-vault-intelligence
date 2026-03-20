import { expect, test, describe } from 'vitest';

import { stripStopWords, semanticSplit, calculateInheritedScore, estimateTokens, recursiveCharacterSplitter, sanitizeProperty, ensureArray, sanitizeExcalidrawContent, extractHeaders, parseYaml } from '../../src/utils/indexer-utils';

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

});
