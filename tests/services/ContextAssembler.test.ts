import { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextAssembler } from "../../src/services/ContextAssembler";

describe("ContextAssembler", () => {
    let mockApp: App;
    let assembler: ContextAssembler;

    beforeEach(() => {
        mockApp = {
            vault: {
                cachedRead: vi.fn(),
                getAbstractFileByPath: vi.fn((path: string) => {
                    const fakeFile = Object.create(TFile.prototype) as TFile;
                    Object.defineProperty(fakeFile, "path", { value: path });
                    return fakeFile;
                }),
            },
        } as unknown as App;

        // graphService, settings, and mcpClientManager stay undefined, so
        // assemble() uses the SEARCH_CONSTANTS defaults (charsPerToken 4,
        // soft-limit ratio 0.30, thresholds 0.90/0.70/0.20) and an empty
        // metadata map.
        assembler = new ContextAssembler(mockApp);
    });

    /**
     * Standalone fence pairing: every fence opened by a line of at least
     * three markers must be closed by a matching closer line within the
     * same excerpt. Copied verbatim from tests/utils/indexer-utils.test.ts
     * so the assembler assertions verify balance exactly like the
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

    /**
     * Parses assemble() output into per-document fragments. Each fragment is
     * the content between the header that precedes it and the header that
     * follows (or end of string); the leading empty piece is dropped.
     */
    const parseFragments = (context: string): string[] =>
        context.split(/\n--- Document: [^\n]+ ---\n/).filter(fragment => fragment.length > 0);

    const fragmentAt = (context: string, index: number, expectedCount: number): string => {
        const fragments = parseFragments(context);
        expect(fragments).toHaveLength(expectedCount);
        return fragments[index] ?? "";
    };

    it("balances a primary full-file injection that ends with an unclosed fence", async () => {
        const content = "Notes on the assembler.\n```python\nprint('hello')\nprint('done')\n";
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);

        const assembled = await assembler.assemble([{ path: "note.md", score: 1.0 }], "needle", 1000);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(isBalanced(fragment)).toBe(true);
        expect(fragment).toContain("print('done')\n```\n");
    });

    it("balances a primary fallback clip that ends mid-fence", async () => {
        const opening = "Prose heading.\n" + "p".repeat(1185) + "\n```python\n";
        const code = `x = "${"z".repeat(480)}"\ny = 42\n`;
        const content = opening + code + "```\n";
        // Design guards: the document must exceed the 400-token soft limit so
        // the clip branch runs, the cut must land mid-code line so the real
        // closer sits outside the slice, and the opener must be its own line
        // so fence detection opens it.
        expect(content.length).toBe(1709);
        expect(content.charAt(1599)).toBe("z");
        const openerStart = content.indexOf("```");
        expect(content.charAt(openerStart - 1)).toBe("\n");
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);

        const assembled = await assembler.assemble([{ path: "note.md", score: 1.0 }], "needle", 400);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(isBalanced(fragment)).toBe(true);
        expect(fragment).toContain("```python");
        expect(fragment).toContain("```\n\n...[clipped]...");
    });

    it("balances a keyword window that begins inside a fence with a synthetic opener", async () => {
        // The needle sits 971 characters past the opener, so the window
        // [1000 - 800, 1000 + 800) starts strictly inside the fence while the
        // fence's real closer (just after the needle) stays fully inside.
        const content = "Prose before code.\n```python\n" + "z".repeat(971) + "needle\n```\n" + "w".repeat(790);
        expect(content.indexOf("needle")).toBe(1000);
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);

        const assembled = await assembler.assemble([{ isKeywordMatch: true, path: "note.md", score: 1.0 }], "needle", 400);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(isBalanced(fragment)).toBe(true);
        expect(fragment).toContain("...[clipped]...\n```python\n");
    });

    it("balances a keyword window that ends inside a fence with a synthetic closer", async () => {
        // The needle sits 688 characters into the fence body and the closer
        // lies beyond the window [200, 1800), so only a closing line can
        // balance the fragment.
        const content = "a".repeat(300) + "\n```python\n" + "z".repeat(688) + "\nneedle\n" + "z".repeat(1192) + "\n```\n" + "w".repeat(199);
        expect(content.indexOf("needle")).toBe(1000);
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);

        const assembled = await assembler.assemble([{ isKeywordMatch: true, path: "note.md", score: 1.0 }], "needle", 400);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(isBalanced(fragment)).toBe(true);
        expect(fragment).toContain("\n```\n\n...[clipped]...");
    });

    it("balances a supporting-tier clip that ends mid-fence", async () => {
        const primaryContent = "Fenceless note one.\n" + "d".repeat(80);
        const supportContent = "x".repeat(295) + "\n```python\n" + "y".repeat(845) + "\n```\n";
        // Design guard: the 600-character support window must land mid-code
        // line, past the opener and before the closer.
        expect(supportContent.charAt(599)).toBe("y");
        const contents: Record<string, string> = { "doc1.md": primaryContent, "doc2.md": supportContent };
        mockApp.vault.cachedRead = vi.fn((file: TFile) => Promise.resolve(contents[file.path] ?? ""));

        const assembled = await assembler.assemble([
            { path: "doc1.md", score: 1.0 },
            { path: "doc2.md", score: 0.8 },
        ], "needle", 1000);
        const primaryFragment = fragmentAt(assembled.context, 0, 2);
        const supportFragment = fragmentAt(assembled.context, 1, 2);

        expect(isBalanced(primaryFragment)).toBe(true);
        expect(isBalanced(supportFragment)).toBe(true);
        expect(supportFragment).toContain("\n```\n\n...[clipped]...");
        expect(assembled.usedFiles).toEqual(["doc1.md", "doc2.md"]);
    });

    it("keeps every fragment between document headers fence-balanced", async () => {
        const primaryContent = "Primary note text.\n```python\n" + "z".repeat(560) + "\n";
        const supportContent = "Fenceless supporting document text.\n" + "m".repeat(568);
        const contents: Record<string, string> = {
            "docs/primary.md": primaryContent,
            "docs/structural.md": "Structural note body.",
            "docs/support.md": supportContent,
        };
        mockApp.vault.cachedRead = vi.fn((file: TFile) => Promise.resolve(contents[file.path] ?? ""));

        const assembled = await assembler.assemble([
            { path: "docs/structural.md", score: 0.4 },
            { path: "docs/support.md", score: 0.8 },
            { path: "docs/primary.md", score: 1.0 },
        ], "needle", 2000);

        const headers = assembled.context.match(/\n--- Document: [^\n]+ ---\n/g) ?? [];
        expect(headers).toHaveLength(3);
        for (const fragment of parseFragments(assembled.context)) {
            expect(isBalanced(fragment)).toBe(true);
        }
        // The primary note's unclosed fence gains its synthetic closing line.
        expect(fragmentAt(assembled.context, 0, 3).endsWith("```\n\n")).toBe(true);
        expect(assembled.usedFiles).toEqual(["docs/primary.md", "docs/support.md", "docs/structural.md"]);
    });

    it("keeps fenceless output byte-identical on all three emission paths", async () => {
        const clipSource = "p".repeat(2400);
        const keywordSource = "z".repeat(900) + "needle" + "z".repeat(700);
        const fullSource = "f".repeat(600);
        mockApp.vault.cachedRead = vi.fn()
            .mockResolvedValueOnce(clipSource)
            .mockResolvedValueOnce(keywordSource)
            .mockResolvedValueOnce(fullSource);

        // Default clip path: no keyword match, start of document.
        const clipped = await assembler.assemble([{ path: "note.md", score: 1.0 }], "needle", 400);
        expect(fragmentAt(clipped.context, 0, 1)).toBe(clipSource.substring(0, 1600) + "\n...[clipped]..." + "\n");

        // Keyword window path: the window follows the clipContent recipe.
        const idx = keywordSource.indexOf("needle");
        const start = Math.max(0, idx - 800);
        const end = Math.min(keywordSource.length, idx + 800);
        const keyword = await assembler.assemble([{ isKeywordMatch: true, path: "note.md", score: 1.0 }], "needle", 400);
        expect(fragmentAt(keyword.context, 0, 1)).toBe("...[clipped]...\n" + keywordSource.substring(start, end) + "\n...[clipped]..." + "\n");

        // Full-file path.
        const full = await assembler.assemble([{ path: "note.md", score: 1.0 }], "needle", 1000);
        expect(fragmentAt(full.context, 0, 1)).toBe(fullSource + "\n");
    });

    it("balances a CRLF clip that ends mid-fence with an LF synthetic closer", async () => {
        const content = "p".repeat(1185) + "\r\n```python\r\n" + "z".repeat(480) + "\r\n" + "z".repeat(480) + "\r\n```\r\n" + "w".repeat(200);
        // Design guard: the 1600-character cut must land inside the second
        // code line, not on the CRLF pair.
        expect(content.length).toBe(2367);
        expect(content.charAt(1599)).toBe("z");
        expect(content.indexOf("```", 1)).toBeLessThan(1600);
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);

        const assembled = await assembler.assemble([{ path: "note.md", score: 1.0 }], "needle", 400);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(isBalanced(fragment)).toBe(true);
        expect(fragment).toContain("```\n\n...[clipped]...");
    });

    it("passes excerpts through unmodified on the primary tier", async () => {
        const excerpt = "```js\nconsole.log('ok');\n```";
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue("c".repeat(2400));

        const assembled = await assembler.assemble([{ excerpt, path: "note.md", score: 1.0, tokenCount: 8 }], "needle", 400);
        const fragment = fragmentAt(assembled.context, 0, 1);

        expect(fragment).toBe(excerpt + "\n");
    });

    it("passes excerpts through unmodified on the supporting tier", async () => {
        const primaryContent = "Primary fenceless note." + "d".repeat(76);
        const excerpt = "```js\nconsole.log('ok');\n```";
        const contents: Record<string, string> = { "a.md": primaryContent, "b.md": "Supporting full text.".repeat(50) };
        mockApp.vault.cachedRead = vi.fn((file: TFile) => Promise.resolve(contents[file.path] ?? ""));

        const assembled = await assembler.assemble([
            { excerpt, path: "b.md", score: 0.8, tokenCount: 8 },
            { path: "a.md", score: 1.0 },
        ], "needle", 1000);
        const primaryFragment = fragmentAt(assembled.context, 0, 2);
        const supportFragment = fragmentAt(assembled.context, 1, 2);

        expect(isBalanced(primaryFragment)).toBe(true);
        expect(supportFragment).toBe(excerpt + "\n");
        expect(assembled.usedFiles).toEqual(["a.md", "b.md"]);
    });
});