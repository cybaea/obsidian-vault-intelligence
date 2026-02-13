/* eslint-disable eslint-comments/disable-enable-pair -- Allow disabling rules for the whole file */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking complex Obsidian types requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking complex Obsidian types requires unsafe access */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking complex Obsidian types requires unsafe calls */
import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultHydrator } from '../../src/services/ResultHydrator';
import { VaultManager } from '../../src/services/VaultManager';
import { GraphSearchResult } from '../../src/types/graph';
import { fastHash } from '../../src/utils/link-parsing';

// Mock Obsidian
vi.mock('obsidian', () => {
    class MockTFile {
        basename: string;
        extension: string;
        path: string;
        constructor() {
            this.path = '';
            this.basename = '';
            this.extension = '';
        }
    }
    return {
        App: class { },
        TAbstractFile: class { },
        TFile: MockTFile
    };
});

describe('ResultHydrator', () => {
    let hydrator: ResultHydrator;
    let mockApp: App;
    let mockVaultManager: VaultManager;

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn(),
                read: vi.fn()
            }
        } as unknown as App;

        mockVaultManager = {
            getFileByPath: vi.fn(),
            readFile: vi.fn()
        } as unknown as VaultManager;

        hydrator = new ResultHydrator(mockApp, mockVaultManager);
    });

    it('should correctly hydrate content when hashes match (including whitespace)', async () => {
        const filePath = 'test.md';
        const rawContent = '\n\n# Header\nMatched Content \n'; // Note trailing space
        const targetSnippet = 'Matched Content ';
        const start = 12; // 2 newlines + "# Header\n" length
        const end = 12 + targetSnippet.length;

        // Setup Hash
        const hash = fastHash(targetSnippet);

        // Mock File
        // Mock File
        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);


        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated).toHaveLength(1);
        // The hydrator SHOULD clean the snippet for display (trim)
        // But importantly, it should NOT have detected drift during verification
        expect(result.hydrated[0]!.excerpt).toBe('Matched Content');
    });

    it('should NOT detect drift when snippet has whitespace but matches untrimmed hash', async () => {
        const filePath = 'test.md';
        // Worker indexed "  spaced  "
        // Previous bug: Hydrator extracted "  spaced  ", trimmed to "spaced", hashed "spaced" -> Mismatch
        // Fix: Hydrator extracts "  spaced  ", hashes "  spaced  " -> Match -> THEN trims for display
        const targetSnippet = '  spaced  ';
        const rawContent = `Prefix${targetSnippet}Suffix`;
        const start = 6;
        const end = 6 + targetSnippet.length;
        const hash = fastHash(targetSnippet);

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated[0]!.excerpt).toBe('spaced'); // Checked display is clean
    });

    it('should sanitize Excalidraw content before alignment', async () => {
        const filePath = 'drawing.excalidraw.md';
        // Worker only sees the markdown part
        const markdownPart = '# Visible\nText';
        const jsonBlock = '\n```compressed-json\n{"data":"hidden"}\n```';
        const rawContent = markdownPart + jsonBlock;

        const targetSnippet = 'Text';
        // Offsets are relative to SANITIZED content (just markdownPart)
        const start = 10; // "# Visible\n".length
        const end = 14;
        const hash = fastHash(targetSnippet);

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated[0]!.excerpt).toBe('Text');
    });

    it('should detect drift when content actually differs', async () => {
        const filePath = 'test.md';
        const rawContent = 'Original Content';
        const start = 0;
        const end = 8;
        const hash = fastHash('Modified'); // Hash mismatch

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        expect(result.driftDetected).toHaveLength(1);
        expect(result.driftDetected[0]!.path).toBe(filePath);
        expect(result.hydrated[0]!.excerpt).toBe('(Content drifted - Re-indexing in background)');
    });

    it('should heal drift using sliding window for multi-line chunks', async () => {
        const filePath = 'drift.md';
        const chunkText = 'Line 1\nLine 2\nLine 3';
        const hash = fastHash(chunkText);

        // Text moved: inserted text at the beginning
        const rawContent = 'Newly inserted text\n\n' + chunkText;

        // Original offsets (where it was before drift)
        const start = 0;
        const end = chunkText.length;

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        // Verification: Even though offsets were wrong (0..21), 
        // it found it at (21..42) via sliding window
        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated[0]!.excerpt).toContain('Line 1 Line 2 Line 3');
    });

    it('should maintain offset stability when sanitizing large blocks', async () => {
        const filePath = 'offset_test.md';
        // A block that is sanitized away
        const jsonBlock = '```compressed-json\n' + 'A'.repeat(100) + '\n```';
        const targetText = 'Stable Content';
        const rawContent = jsonBlock + '\n' + targetText;

        const hash = fastHash(targetText);
        // Offset is relative to full file length
        const start = jsonBlock.length + 1;
        const end = start + targetText.length;

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        // If sanitization uses "repeat space", offset (122) points exactly 
        // to "Stable Content". If it used "", it would fail.
        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated[0]!.excerpt).toBe(targetText);
    });

    it('should re-hydrate hollow results from cold store', async () => {
        const filePath = 'cold_store.md';
        const content = 'Persisted Content';
        const hash = fastHash(content);

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(content);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end: content.length,
            excerpt: '', // HOLLOW
            path: filePath,
            score: 1.0,
            start: 0
        }];

        const result = await hydrator.hydrate(input);

        expect(result.hydrated[0]!.excerpt).toBe(content);
        expect(result.driftDetected).toHaveLength(0);
    });

    it('should correctly hydrate when body content also appears in frontmatter (collision)', async () => {
        const filePath = 'collision.md';
        // Note: The title in frontmatter matches the first header in body
        const rawContent = `---\ntitle: My Header\n---\n\n# My Header\nActual Body`;

        // The worker now uses splitFrontmatter's bodyOffset
        // let's simulate the correct offsets from the worker
        const bodyOffset = rawContent.indexOf('\n# My Header') + 1; // Correct offset

        const chunk = '# My Header';
        const start = bodyOffset;
        const end = bodyOffset + chunk.length;
        const hash = fastHash(chunk);

        const mockFile = new TFile();
        mockFile.path = filePath;
        (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
        (mockVaultManager.readFile as any).mockResolvedValue(rawContent);

        const input: GraphSearchResult[] = [{
            anchorHash: hash,
            end,
            path: filePath,
            score: 1.0,
            start
        }];

        const result = await hydrator.hydrate(input);

        // This verifies that the hydrator looks at the correct absolute offset [19, 30]
        // If it used a relative offset or a broken discovery, it might fail.
        expect(result.driftDetected).toHaveLength(0);
        expect(result.hydrated[0]!.excerpt).toBe('My Header');
    });
});
