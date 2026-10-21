import { App, TFile } from "obsidian";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ResultHydrator } from "../../src/services/ResultHydrator";
import { VaultManager } from "../../src/services/VaultManager";
import { semanticSplit } from "../../src/utils/indexer-utils";
import { fastHash, splitFrontmatter } from "../../src/utils/link-parsing";

describe("ResultHydrator", () => {
    let mockApp: App;
    let mockVaultManager: VaultManager;
    let hydrator: ResultHydrator;

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn((path) => {
                    if (path === "test.md") {
                        const fakeFile = Object.create(TFile.prototype) as TFile;
                        Object.defineProperty(fakeFile, 'path', { value: "test.md" });
                        return fakeFile;
                    }
                    return null;
                })
            }
        } as unknown as App;

        mockVaultManager = {
            readFile: vi.fn()
        } as unknown as VaultManager;

        hydrator = new ResultHydrator(mockApp, mockVaultManager);
    });

    it("should find deeply drifted text using Rabin-Karp rolling hash", async () => {
        const originalSnippet = "brown fox jumps";
        const expectedHash = fastHash(originalSnippet);

        const currentFileContent = "Some new prefix text.\nThe quick brown fox jumps over the lazy dog.\nSome suffix suffix.";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(currentFileContent);

        // Mock drift parameters: Original indices before text drifted
        const results = await hydrator.hydrate([
            {
                anchorHash: expectedHash,
                end: 20,
                path: "test.md",
                score: 1.0,
                start: 5
            }
        ]);

        expect(results.hydrated).toHaveLength(1);
        expect(results.hydrated[0]?.excerpt).toBe(originalSnippet);
        expect(results.driftDetected).toHaveLength(0); // Successfully healed
    });

    it("should keep the hollow result when hydration throws", async () => {
        const sample = {
            anchorHash: 123,
            end: 10,
            path: "test.md",
            score: 1.0,
            start: 0
        };
        mockVaultManager.readFile = vi.fn().mockRejectedValue(new Error("disk gone"));

        const results = await hydrator.hydrate([sample]);

        expect(results.hydrated).toEqual([sample]);
        expect(results.driftDetected).toHaveLength(0);
    });

    it("should clean worker excerpts on the Case 1 path without re-balancing", async () => {
        const excerpt = "```py\nvalue = 1\n```";
        const results = await hydrator.hydrate([
            {
                excerpt: excerpt,
                path: "test.md",
                score: 2.0,
                tokenCount: 10
            }
        ]);

        expect(mockVaultManager.readFile).not.toHaveBeenCalled();
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
        expect(results.hydrated[0]?.score).toBe(2.0);
    });

    it("should report drift when the file is too short to hold the anchor", async () => {
        mockVaultManager.readFile = vi.fn().mockResolvedValue("tiny");

        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash("```py\nvalue = 1"),
                end: 15,
                path: "test.md",
                score: 1.0,
                start: 0
            }
        ]);

        expect(results.driftDetected).toHaveLength(1);
        expect(results.hydrated[0]?.excerpt).toBe("(Content drifted - Re-indexing in background)");
    });

    it("should balance an aligned excerpt that sits inside an unclosed fence", async () => {
        const content = "prose\n```python\nvalue = 1\nprint(value)";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(content);

        const start = content.indexOf("```python");
        const end = content.length;
        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash(content.slice(start, end)),
                end: end,
                path: "test.md",
                score: 1.0,
                start: start
            }
        ]);

        expect(results.driftDetected).toHaveLength(0);
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
    });

    it("should leave a complete fence in an aligned excerpt self-balanced", async () => {
        const content = "prose\n```py\nvalue = 1\n```\nsummary text";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(content);

        const start = content.indexOf("```py");
        const end = content.length;
        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash(content.slice(start, end)),
                end: end,
                path: "test.md",
                score: 1.0,
                start: start
            }
        ]);

        expect(results.driftDetected).toHaveLength(0);
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block] summary text");
    });

    it("should heal a drifted excerpt that reappears at the window start", async () => {
        const content = "value = 1\nmore text now";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(content);

        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash("value = 1"),
                end: 29,
                path: "test.md",
                score: 1.0,
                start: 20
            }
        ]);

        expect(results.driftDetected).toHaveLength(0);
        expect(results.hydrated[0]?.excerpt).toBe("value = 1");
    });

    it("should heal an interior chunk of a large fence after a frontmatter drift", async () => {
        const lines = Array.from({ length: 500 }, (_, index) => `const line_${index} = ${index};`);
        const fence = "```ts\n" + lines.join("\n") + "\n```";
        const originalContent = `---\ntitle: Big\n---\n# Header\n${fence}\nTail`;
        const driftedContent = `---\ntitle: Big (Updated)\n---\n# Header\n${fence}\nTail`;
        const { body, bodyOffset } = splitFrontmatter(originalContent);
        const chunks = semanticSplit(body, 500);

        // An interior code chunk deep inside the oversized fence.
        const middleChunk = chunks[10];
        expect(middleChunk?.fenceAugmented).toBe(true);
        const anchorHash = fastHash(body.slice(middleChunk?.start ?? 0, middleChunk?.end ?? 0));
        const result = {
            anchorHash,
            end: (middleChunk?.end ?? 0) + bodyOffset,
            path: "test.md",
            score: 1.0,
            start: (middleChunk?.start ?? 0) + bodyOffset
        };

        mockVaultManager.readFile = vi.fn().mockResolvedValue(driftedContent);
        const results = await hydrator.hydrate([result]);

        expect(results.driftDetected).toHaveLength(0);
        // The raw slice is re-balanced with the fence's own marker before cleaning.
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
    });

    it("should not mask drift when a fenced excerpt no longer matches", async () => {
        const content = "```py\ncompletely different code now";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(content);

        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash("```py\nvalue = 1"),
                end: 15,
                path: "test.md",
                score: 1.0,
                start: 0
            }
        ]);

        expect(results.driftDetected).toHaveLength(1);
        expect(results.hydrated[0]?.excerpt).toBe("(Content drifted - Re-indexing in background)");
    });

    it("should balance the anchorless fallback excerpt when the body starts with an unclosed fence", async () => {
        const content = "```py\nvalue = 1\nprint(value)";
        mockVaultManager.readFile = vi.fn().mockResolvedValue(content);

        const results = await hydrator.hydrate([
            {
                path: "test.md",
                score: 1.0
            }
        ]);

        expect(results.hydrated[0]?.excerpt).toBe("[Code Block] ...");
    });
});
