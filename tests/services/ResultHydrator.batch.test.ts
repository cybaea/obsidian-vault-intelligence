import { App, TFile } from "obsidian";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ResultHydrator } from "../../src/services/ResultHydrator";
import { VaultManager } from "../../src/services/VaultManager";
import { GraphSearchResult } from "../../src/types/graph";
import { findCodeFenceIntervals } from "../../src/utils/indexer-utils";
import { fastHash } from "../../src/utils/link-parsing";

// Passthrough spy: counts only ResultHydrator's direct full-content scans.
// Scans inside getFenceAugmentation use the actual internal binding and are
// not counted, which is exactly the acceptance-criterion observable.
vi.mock("../../src/utils/indexer-utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/utils/indexer-utils")>();
    return { ...actual, findCodeFenceIntervals: vi.fn(actual.findCodeFenceIntervals) };
});

describe("ResultHydrator batch memoisation", () => {
    let mockApp: App;
    let mockVaultManager: VaultManager;
    let hydrator: ResultHydrator;
    const spy = vi.mocked(findCodeFenceIntervals);

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn((path: string) => {
                    if (path === "test.md" || path === "other.md") {
                        const fakeFile = Object.create(TFile.prototype) as TFile;
                        Object.defineProperty(fakeFile, 'path', { value: path });
                        return fakeFile;
                    }
                    return null;
                })
            }
        } as unknown as App;

        mockVaultManager = { readFile: vi.fn() } as unknown as VaultManager;
        hydrator = new ResultHydrator(mockApp, mockVaultManager);
        spy.mockClear();
    });

    it("reads once and scans once for duplicates of a path in a batch", async () => {
        const content = "```py\nvalue = 1\n```\nprose text";
        vi.mocked(mockVaultManager.readFile).mockResolvedValue(content);

        const batch: GraphSearchResult[] = [
            {
                anchorHash: fastHash(content.slice(0, 15)),
                end: 15,
                path: "test.md",
                score: 1.0,
                start: 0
            },
            {
                anchorHash: fastHash(content.slice(20, 30)),
                end: 30,
                path: "test.md",
                score: 1.0,
                start: 20
            }
        ];

        const results = await hydrator.hydrate(batch);

        expect(mockVaultManager.readFile).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(content);
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
        expect(results.hydrated[1]?.excerpt).toBe("prose text");
        expect(results.driftDetected).toHaveLength(0);
    });

    it("never scans the full file for anchorless neighbours", async () => {
        const content = "```py\nvalue = 1\nprint(value)";
        vi.mocked(mockVaultManager.readFile).mockResolvedValue(content);

        const batch: GraphSearchResult[] = [
            { path: "test.md", score: 1.0 },
            { path: "test.md", score: 2.0 }
        ];

        const results = await hydrator.hydrate(batch);

        expect(mockVaultManager.readFile).toHaveBeenCalledTimes(1);
        expect(spy).not.toHaveBeenCalled();
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block] ...");
        expect(results.hydrated[1]?.excerpt).toBe("[Code Block] ...");
        expect(results.driftDetected).toHaveLength(0);
    });

    it("keeps results hollow on a shared read rejection without touching sibling paths", async () => {
        vi.mocked(mockVaultManager.readFile).mockImplementation((file: TFile) => {
            if (file.path === "test.md") return Promise.reject(new Error("disk gone"));
            return Promise.resolve("Hello world");
        });

        const testAnchored: GraphSearchResult = {
            anchorHash: 123,
            end: 10,
            path: "test.md",
            score: 1.0,
            start: 0
        };
        const testAnchorless: GraphSearchResult = {
            path: "test.md",
            score: 1.0
        };
        const otherAnchorless: GraphSearchResult = {
            path: "other.md",
            score: 1.0
        };

        const results = await hydrator.hydrate([testAnchored, testAnchorless, otherAnchorless]);

        expect(results.hydrated[0]).toBe(testAnchored);
        expect(results.hydrated[1]).toBe(testAnchorless);
        expect(results.hydrated[2]?.excerpt).toBe("Hello world...");
        expect(results.driftDetected).toHaveLength(0);
        expect(mockVaultManager.readFile).toHaveBeenCalledTimes(2);
    });

    it("reads and scans every distinct path once", async () => {
        const testContent = "```py\nvalue = 1\n```\nprose text";
        const otherContent = "```ts\nconst a = 1\n```\nmore prose";
        vi.mocked(mockVaultManager.readFile).mockImplementation((file: TFile) => {
            if (file.path === "test.md") return Promise.resolve(testContent);
            return Promise.resolve(otherContent);
        });

        const results = await hydrator.hydrate([
            {
                anchorHash: fastHash(testContent.slice(0, 15)),
                end: 15,
                path: "test.md",
                score: 1.0,
                start: 0
            },
            {
                anchorHash: fastHash(otherContent.slice(0, 17)),
                end: 17,
                path: "other.md",
                score: 1.0,
                start: 0
            }
        ]);

        expect(mockVaultManager.readFile).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenNthCalledWith(1, testContent);
        expect(spy).toHaveBeenNthCalledWith(2, otherContent);
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
        expect(results.hydrated[1]?.excerpt).toBe("[Code Block]");
        expect(results.driftDetected).toHaveLength(0);
    });

    it("bypasses reads and scans entirely for excerpt-carrying results", async () => {
        const batch: GraphSearchResult[] = [
            {
                excerpt: "```py\nvalue = 1\n```",
                path: "test.md",
                score: 1.0,
                tokenCount: 10
            },
            {
                excerpt: "plain prose",
                path: "other.md",
                score: 2.0
            }
        ];

        const results = await hydrator.hydrate(batch);

        expect(mockVaultManager.readFile).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
        expect(results.hydrated[0]?.excerpt).toBe("[Code Block]");
        expect(results.hydrated[1]?.excerpt).toBe("plain prose");
        expect(results.driftDetected).toHaveLength(0);
    });
});