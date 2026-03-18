import { App, TFile } from "obsidian";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ResultHydrator } from "../../src/services/ResultHydrator";
import { VaultManager } from "../../src/services/VaultManager";
import { fastHash } from "../../src/utils/link-parsing";

describe("ResultHydrator", () => {
    let mockApp: App;
    let mockVaultManager: VaultManager;
    let hydrator: ResultHydrator;

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn((path) => {
                    if (path === "test.md") {
                        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- mocking internal obsidian behaviour
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
        mockVaultManager.readFile = vi.fn().mockResolvedValue(currentFileContent as never) as never;

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
});
