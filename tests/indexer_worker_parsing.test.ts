import { describe, it, expect } from 'vitest';
import { extractLinks } from '../src/workers/indexer.worker';

describe('extractLinks', () => {
    describe('Wikilinks', () => {
        it('should extract standard wikilinks', () => {
            const text = 'Check out [[Note A]] and [[Note B|Alias]].';
            expect(extractLinks(text)).toEqual(['Note A', 'Note B']);
        });

        it('should handle multiple links on the same line', () => {
            const text = '[[Link 1]] [[Link 2]] [[Link 3]]';
            expect(extractLinks(text)).toEqual(['Link 1', 'Link 2', 'Link 3']);
        });

        it('should ignore links inside single backtick code spans', () => {
            const text = 'This is `[[not a link]]` but this is [[a link]].';
            expect(extractLinks(text)).toEqual(['a link']);
        });

        it('should ignore links inside triple backtick code blocks', () => {
            const text = `
Here is a code block:
\`\`\`
[[not a link]]
\`\`\`
And a [[real link]].
`;
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should ignore wikilinks with newlines', () => {
            const text = '[[Link across\nmultiple lines]] but [[valid link]]';
            expect(extractLinks(text)).toEqual(['valid link']);
        });

        it('should ignore escaped wikilinks', () => {
            const text = '\\[[not a link]] and [[real link]]';
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should handle complex aliases with brackets', () => {
            const text = '[[Note with [brackets] | alias with [brackets] ]]';
            expect(extractLinks(text)).toEqual(['Note with [brackets]']);
        });

        it('should return duplicate links if they exist (to be handled by caller)', () => {
            const text = '[[Link A]] and [[Link A]]';
            expect(extractLinks(text)).toEqual(['Link A', 'Link A']);
        });
    });

    describe('Standard Markdown Links', () => {
        it('should extract standard markdown links', () => {
            const text = 'Check out [Note A](Note%20A.md) and [Note B](Note%20B.md).';
            expect(extractLinks(text)).toEqual(['Note A.md', 'Note B.md']);
        });

        it('should ignore external links', () => {
            const text = 'Go to [Google](https://google.com) or [Email](mailto:test@example.com) and check [[Note A]].';
            expect(extractLinks(text)).toEqual(['Note A']);
        });

        it('should strip anchors from standard links', () => {
            const text = 'See [Section](Note.md#Section) or [another](AnotherNote.md#header).';
            expect(extractLinks(text)).toEqual(['Note.md', 'AnotherNote.md']);
        });

        it('should handle vault-absolute paths by stripping leading slash', () => {
            const text = 'Link to [/Folder/Note.md](/Folder/Note.md).';
            expect(extractLinks(text)).toEqual(['Folder/Note.md']);
        });

        it('should decode URL-encoded segments', () => {
            const text = 'Link to [Space](Folder/My%20Note.md).';
            expect(extractLinks(text)).toEqual(['Folder/My Note.md']);
        });

        it('should handle nested brackets in text portion', () => {
            const text = 'Link [with [brackets]](Note.md).';
            expect(extractLinks(text)).toEqual(['Note.md']);
        });

        it('should handle nested parentheses in URL portion', () => {
            const text = 'Link to [Note](Path/To(Note).md).';
            expect(extractLinks(text)).toEqual(['Path/To(Note).md']);
        });

        it('should ignore standard links inside code', () => {
            const text = '`[not a link](file.md)` and [[real link]].';
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should handle mixed wikilinks and standard links', () => {
            const text = '[[WikiLink]] and [Standard Link](StandardLink.md).';
            expect(extractLinks(text)).toEqual(['WikiLink', 'StandardLink.md']);
        });
    });

    describe('Edge Cases & Code Robustness', () => {
        it('should handle escaped backticks inside code spans', () => {
            const text = '`code with escaped backtick \\` [[not a link]]` [[real link]]';
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should handle multi-backtick delimiters', () => {
            const text = 'Double backticks `` `[[not a link]]` `` and [[real link]].';
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should ignore links in nested code blocks', () => {
            const text = '`[[not a link]]` and `` [[not a link either]] `` and [[real link]]';
            expect(extractLinks(text)).toEqual(['real link']);
        });

        it('should handle code blocks not at the start of the line', () => {
            const text = 'Text before ```\n[[not a link]]\n``` and [[real link]]';
            expect(extractLinks(text)).toEqual(['real link']);
        });
    });
});
