import { App, TFile, TFolder } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OntologyService } from '../../src/services/OntologyService';
import { VaultIntelligenceSettings } from '../../src/settings/types';

describe('OntologyService', () => {
    /**
     * Standalone fence pairing: every fence opened by a line of at least
     * three markers must be closed by a matching closer line within the
     * same excerpt. Copied verbatim from tests/utils/indexer-utils.test.ts
     * so these assertions verify balance exactly like the augmentation
     * utilities' own suite does.
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

    // The mocked TFolder class is property-less, so the folder fixtures are
    // genuine TFolder instances (the instanceof checks in getOntologyContext
    // require real class instances) with the structure attached through an
    // intersection-typed local rather than unchecked casts.
    type FolderNode = TFolder & { children: (TFile | TFolder)[]; name: string; path: string };

    const makeFolder = (name: string, path: string, children: (TFile | TFolder)[]): FolderNode => {
        const folder = Object.create(TFolder.prototype) as FolderNode;
        folder.name = name;
        folder.path = path;
        folder.children = children;
        return folder;
    };

    const makeFile = (name: string, path: string): TFile => {
        const file = new TFile();
        file.name = name;
        file.path = path;
        return file;
    };

    const CONCEPTS_INDEX_PATH = 'Ontology/Concepts/Concepts.md';
    const INSTRUCTIONS_PATH = 'Ontology/Instructions.md';

    let mockApp: App;
    let service: OntologyService;

    beforeEach(() => {
        const conceptsIndex = makeFile('Concepts.md', CONCEPTS_INDEX_PATH);
        const instructionsFile = makeFile('Instructions.md', INSTRUCTIONS_PATH);
        const conceptsFolder = makeFolder('Concepts', 'Ontology/Concepts', []);
        const baseFolder = makeFolder('Ontology', 'Ontology', [conceptsFolder, instructionsFile]);

        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
                    if (path === 'Ontology') return baseFolder;
                    if (path === CONCEPTS_INDEX_PATH) return conceptsIndex;
                    return null;
                }),
                read: vi.fn(),
            },
        } as unknown as App;

        const mockSettings = { ontologyPath: 'Ontology' } as unknown as VaultIntelligenceSettings;
        service = new OntologyService(mockApp, mockSettings);
    });

    // vault.read is keyed on the file's path so each test maps the fixture
    // content the service will read.
    const setReadContents = (contentsByPath: Record<string, string>): void => {
        (mockApp.vault.read as any).mockImplementation((file: TFile) => Promise.resolve(contentsByPath[file.path] ?? ''));
    };

    describe('getOntologyContext', () => {
        it('balances a backtick fence spanning the 500-char folder-index cut', async () => {
            const spanning = 'c'.repeat(400) + '\n```python\n' + 'x'.repeat(200);
            setReadContents({ [CONCEPTS_INDEX_PATH]: spanning });

            const result = await service.getOntologyContext();
            const folderContext = result.folders['Concepts'] as string;

            expect(folderContext).toBe(spanning.slice(0, 500) + '\n```\n');
            expect(isBalanced(folderContext)).toBe(true);
        });

        it('derives a mid-run four-backtick opener from the full folder-index content', async () => {
            // The opener starts at offset 497, so exactly three of its four
            // markers sit inside the 500-char prefix; the closer must carry the
            // true four-marker run from the full-content scan, because a
            // slice-only scan would emit an ineffective three-backtick closer.
            const quadrupleSpanning = 'c'.repeat(496) + '\n' + '````python\nx = 1\n' + 'y'.repeat(100);
            setReadContents({ [CONCEPTS_INDEX_PATH]: quadrupleSpanning });

            const result = await service.getOntologyContext();
            const folderContext = result.folders['Concepts'] as string;

            expect(folderContext).toBe(quadrupleSpanning.slice(0, 500) + '\n````\n');
            expect(isBalanced(folderContext)).toBe(true);
        });

        it('balances a tilde fence spanning the 500-char folder-index cut', async () => {
            const tildeSpanning = 'c'.repeat(400) + '\n~~~\n' + 'x'.repeat(200);
            setReadContents({ [CONCEPTS_INDEX_PATH]: tildeSpanning });

            const result = await service.getOntologyContext();
            const folderContext = result.folders['Concepts'] as string;

            expect(folderContext).toBe(tildeSpanning.slice(0, 500) + '\n~~~\n');
            expect(isBalanced(folderContext)).toBe(true);
        });

        it('balances a CRLF folder index spanning the cut with a \\n synthetic closer', async () => {
            const crlfSpanning = 'c'.repeat(400) + '\r\n```js\r\n' + 'x'.repeat(200);
            setReadContents({ [CONCEPTS_INDEX_PATH]: crlfSpanning });

            const result = await service.getOntologyContext();
            const folderContext = result.folders['Concepts'] as string;

            expect(folderContext).toBe(crlfSpanning.slice(0, 500) + '\n```\n');
            expect(isBalanced(folderContext)).toBe(true);
        });

        it('returns a fenceless folder index byte-identical', async () => {
            const plainIndex = 'Short prose description.';
            setReadContents({ [CONCEPTS_INDEX_PATH]: plainIndex });

            const result = await service.getOntologyContext();

            expect(result.folders['Concepts']).toBe(plainIndex);
        });

        it('returns an already-balanced folder index byte-identical', async () => {
            // The closed fence sits fully inside the prefix and the content is
            // under 500 chars, so the slice is the whole note and stays whole.
            const balancedIndex = '```js\ncode\n```\n' + 'c'.repeat(200);
            setReadContents({ [CONCEPTS_INDEX_PATH]: balancedIndex });

            const result = await service.getOntologyContext();

            expect(result.folders['Concepts']).toBe(balancedIndex.slice(0, 500));
        });

        it('balances an unclosed fence in Instructions.md', async () => {
            const unclosedInstructions = 'Do this\n```js\ncode';
            setReadContents({ [INSTRUCTIONS_PATH]: unclosedInstructions });

            const result = await service.getOntologyContext();
            const instructions = result.instructions as string;

            expect(instructions).toBe(unclosedInstructions + '\n```\n');
            expect(isBalanced(instructions)).toBe(true);
        });

        it('returns fenceless Instructions.md byte-identical', async () => {
            setReadContents({ [INSTRUCTIONS_PATH]: 'Plain prose.' });

            const result = await service.getOntologyContext();

            expect(result.instructions).toBe('Plain prose.');
        });

        it('returns empty folders when the ontology path is not a folder', async () => {
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);

            const result = await service.getOntologyContext();

            expect(result).toEqual({ folders: {} });
        });
    });
});