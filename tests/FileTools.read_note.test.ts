import { App, TFile } from 'obsidian';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { FileTools } from '../src/tools/FileTools';

describe('FileTools.read_note', () => {
    let fileTools: FileTools;
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
        mockFile = new TFile();
        mockFile.path = 'test.md';
        mockFile.basename = 'test';
        mockFile.extension = 'md';

        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
                    if (path === 'test.md') return mockFile;
                    return null;
                }),
                read: vi.fn(),
            },
        } as unknown as App;

        fileTools = new FileTools(mockApp);
    });

    /**
     * Standalone fence pairing: every fence opened by a line of at least
     * three markers must be closed by a matching closer line within the
     * same excerpt. Copied verbatim from tests/utils/indexer-utils.test.ts
     * so the read_note assertions verify balance exactly like the
     * augmentation utilities' own suite does.
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

    const readNoteWith = async (content: string): Promise<string> => {
        (mockApp.vault.read as any).mockResolvedValue(content);
        return await fileTools.readNote('test.md');
    };

    it('should close an unclosed backtick fence with a matching synthetic closer', async () => {
        const unclosedBacktick = 'Intro.\n\n```python\nprint("hi")';

        const result = await readNoteWith(unclosedBacktick);

        expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
        expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
        expect(result).toBe(unclosedBacktick + '\n```\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should close an unclosed tilde fence with a matching synthetic closer', async () => {
        const unclosedTilde = '~~~\ncode';

        const result = await readNoteWith(unclosedTilde);

        expect(result).toBe(unclosedTilde + '\n~~~\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should close an unclosed four-backtick fence with the true marker run', async () => {
        const unclosedQuadruple = 'Text\n````\ncode';

        const result = await readNoteWith(unclosedQuadruple);

        expect(result).toBe(unclosedQuadruple + '\n````\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should close an indented unclosed fence with an unindented closer line', async () => {
        const indented = '   ```js\nlet x;';

        const result = await readNoteWith(indented);

        expect(result).toBe(indented + '\n```\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should skip the separator when the note already ends with a newline', async () => {
        const endsNewline = '```python\nx = 1\n';

        const result = await readNoteWith(endsNewline);

        expect(result).toBe(endsNewline + '```\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should add a newline-terminated synthetic closer to a CRLF note', async () => {
        const crlfNote = '```js\r\ncode\r\n';

        const result = await readNoteWith(crlfNote);

        expect(result).toBe(crlfNote + '```\n');
        expect(isBalanced(result)).toBe(true);
    });

    it('should return fenceless notes byte-identical', async () => {
        const fenceless = 'Just prose.\nNo fences.';

        expect(await readNoteWith(fenceless)).toBe(fenceless);
    });

    it('should return already-balanced notes byte-identical', async () => {
        const balanced = 'Before\n```js\ncode\n```\nAfter';

        expect(await readNoteWith(balanced)).toBe(balanced);
    });

    it('should not double-close a note ending exactly on the closing markers', async () => {
        const endsOnCloser = '```js\ncode\n```';

        expect(await readNoteWith(endsOnCloser)).toBe(endsOnCloser);
    });

    it('should return an empty note byte-identical', async () => {
        expect(await readNoteWith('')).toBe('');
    });
});