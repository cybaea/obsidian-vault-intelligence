import { describe, it, expect } from 'vitest';
import { parseWikilinks } from '../src/workers/indexer.worker';

describe('parseWikilinks', () => {
    it('should extract standard wikilinks', () => {
        const text = 'Check out [[Note A]] and [[Note B|Alias]].';
        expect(parseWikilinks(text)).toEqual(['Note A', 'Note B']);
    });

    it('should handle multiple links on the same line', () => {
        const text = '[[Link 1]] [[Link 2]] [[Link 3]]';
        expect(parseWikilinks(text)).toEqual(['Link 1', 'Link 2', 'Link 3']);
    });

    it('should ignore links inside single backtick code spans', () => {
        const text = 'This is `[[not a link]]` but this is [[a link]].';
        expect(parseWikilinks(text)).toEqual(['a link']);
    });

    it('should ignore links inside triple backtick code blocks', () => {
        const text = `
Here is a code block:
\`\`\`
[[not a link]]
\`\`\`
And a [[real link]].
`;
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should handle escaped backticks inside code spans (FAILING TEST)', () => {
        const text = '`code with escaped backtick \\` [[not a link]]` [[real link]]';
        // Current implementation tries to handle escaped backticks but logic might be fragile
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should ignore wikilinks with newlines', () => {
        // Obsidian does not support newlines in wikilinks
        const text = '[[Link across\nmultiple lines]] but [[valid link]]';
        expect(parseWikilinks(text)).toEqual(['valid link']);
    });

    it('should ignore escaped wikilinks', () => {
        const text = '\\[[not a link]] and [[real link]]';
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should handle complex aliases with brackets', () => {
        const text = '[[Note with [brackets] | alias with [brackets] ]]';
        expect(parseWikilinks(text)).toEqual(['Note with [brackets]']);
    });

    it('should handle multi-backtick delimiters (FAILING TEST)', () => {
        // Markdown allows `` `[[not a link]]` ``
        const text = 'Double backticks `` `[[not a link]]` `` and [[real link]].';
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should ignore links in nested code blocks (FAILING TEST)', () => {
        const text = '`[[not a link]]` and `` [[not a link either]] `` and [[real link]]';
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should handle code blocks not at the start of the line (POTENTIAL ISSUE)', () => {
        const text = 'Text before ```\n[[not a link]]\n``` and [[real link]]';
        expect(parseWikilinks(text)).toEqual(['real link']);
    });

    it('should handle empty or whitespace links', () => {
        const text = '[[]] [[  ]] [[|alias]]';
        expect(parseWikilinks(text)).toEqual([]);
    });

    it('should return duplicate links if they exist (to be handled by caller)', () => {
        const text = '[[Link A]] and [[Link A]]';
        expect(parseWikilinks(text)).toEqual(['Link A', 'Link A']);
    });
});
