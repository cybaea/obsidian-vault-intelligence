/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/require-await -- Mocking async vault.process with sync callbacks triggers this */
/* eslint-disable @typescript-eslint/unbound-method -- vitest expectations on mocked methods trigger this */
import { App, TFile } from 'obsidian';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { FileTools } from '../src/tools/FileTools';

describe('FileTools Atomic Update', () => {
    let fileTools: FileTools;
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
        mockFile = new TFile();
        mockFile.path = 'test.md';
        mockFile.basename = 'test';
        mockFile.extension = 'md';

        mockApp = {
            metadataCache: {
                getFileCache: vi.fn(), // Should NOT be called in atomic mode
            },
            vault: {
                getAbstractFileByPath: vi.fn().mockImplementation((path) => {
                    if (path === 'test.md') return mockFile;
                    return null;
                }),
                modify: vi.fn(),
                process: vi.fn(),
                read: vi.fn(),
            },
        } as unknown as App;

        fileTools = new FileTools(mockApp);
    });

    it('should preserve existing frontmatter during update', async () => {
        const oldContent = '---\ntitle: existing\n---\nBody content';
        const newBodyContent = 'New appended content';

        let capturedResult: string = '';
        (mockApp.vault.process as any).mockImplementation(async (file: TFile, callback: (content: string) => string) => {
            capturedResult = callback(oldContent);
            return capturedResult;
        });

        await fileTools.updateNote('test.md', newBodyContent, 'append');

        expect(mockApp.vault.process).toHaveBeenCalled();
        expect(capturedResult).toContain('---\ntitle: existing\n---');
        expect(capturedResult).toContain('Body content');
        expect(capturedResult).toContain('New appended content');
        expect(mockApp.metadataCache.getFileCache).not.toHaveBeenCalled();
    });

    it('should inject frontmatter if missing', async () => {
        const oldContent = '# No frontmatter here';
        const newBodyContent = 'Overwrite everything';

        let capturedResult: string = '';
        (mockApp.vault.process as any).mockImplementation(async (file: TFile, callback: (content: string) => string) => {
            capturedResult = callback(oldContent);
            return capturedResult;
        });

        await fileTools.updateNote('test.md', newBodyContent, 'overwrite');

        expect(capturedResult.startsWith('---\n---\n')).toBe(true);
        expect(capturedResult).toContain('Overwrite everything');
        expect(capturedResult).not.toContain('# No frontmatter here'); // because overwrite
    });

    it('should handle horizontal rules correctly (no false positive frontmatter)', async () => {
        const oldContent = '---\n# Heading'; // This is a horizontal rule, not frontmatter
        const newBodyContent = 'Appended';

        let capturedResult: string = '';
        (mockApp.vault.process as any).mockImplementation(async (file: TFile, callback: (content: string) => string) => {
            capturedResult = callback(oldContent);
            return capturedResult;
        });

        await fileTools.updateNote('test.md', newBodyContent, 'append');

        expect(capturedResult.startsWith('---\n---\n')).toBe(true); // Injected because --- was HR
        expect(capturedResult).toContain('---\n# Heading'); // Original content treated as body
        expect(capturedResult).toContain('Appended');
    });

    it('should handle "prepend" mode correctly', async () => {
        const oldContent = '---\nt: 1\n---\nOld body';
        const newPart = 'New start';

        let capturedResult: string = '';
        (mockApp.vault.process as any).mockImplementation(async (file: TFile, callback: (content: string) => string) => {
            capturedResult = callback(oldContent);
            return capturedResult;
        });

        await fileTools.updateNote('test.md', newPart, 'prepend');

        expect(capturedResult).toContain('---\nt: 1\n---');
        expect(capturedResult).toContain('New start\n\nOld body');
    });
});
