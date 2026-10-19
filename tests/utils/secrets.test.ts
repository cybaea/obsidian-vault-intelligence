import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { resolveSecrets, sanitizeSecretId } from "../../src/utils/secrets";

describe("Secrets Utils", () => {
    describe("resolveSecrets", () => {
        let mockedGetSecretValue: Mock;

        beforeEach(() => {
            mockedGetSecretValue = vi.fn();
        });

        it("should return an empty object if rawMap is undefined", async () => {
            expect(await resolveSecrets(undefined, mockedGetSecretValue, "p-")).toEqual({});
            expect(await resolveSecrets(null, mockedGetSecretValue, "p-")).toEqual({});
            expect(await resolveSecrets("", mockedGetSecretValue, "p-")).toEqual({});
        });

        it("should parse normal JSON string without secrets", async () => {
            const rawMap = JSON.stringify({ KEY: "value", NUMBER: "123" });
            const result = await resolveSecrets(rawMap, mockedGetSecretValue, "p-");
            expect(result).toEqual({ KEY: "value", NUMBER: "123" });
            expect(mockedGetSecretValue).not.toHaveBeenCalled();
        });

        it("should substitute secrets starting with vi-secret: using prefix", async () => {
            const rawMap = JSON.stringify({ 
                API_KEY: "vi-secret:my-api-key",
                NORMAL: "text"
            });
            mockedGetSecretValue.mockImplementation(async (key: string) => {
                await Promise.resolve();
                if (key === "p-my-api-key") return "resolved-secret-value";
                return null;
            });

            const result = await resolveSecrets(rawMap, mockedGetSecretValue, "p-");
            expect(result).toEqual({ 
                API_KEY: "resolved-secret-value",
                NORMAL: "text"
            });
            expect(mockedGetSecretValue).toHaveBeenCalledWith("p-my-api-key");
        });

        it("should throw an error if a secret is missing", async () => {
            const rawMap = JSON.stringify({ 
                API_KEY: "vi-secret:missing-api-key"
            });
            mockedGetSecretValue.mockResolvedValue(null);

            await expect(resolveSecrets(rawMap, mockedGetSecretValue, "p-")).rejects.toThrow(
                "Missing secret for API_KEY. Please re-enter it in settings."
            );
        });

        it("should throw an error with invalid JSON representation", async () => {
            await expect(resolveSecrets("not valid json", mockedGetSecretValue, "p-")).rejects.toThrow(
                /Invalid JSON format in configuration/
            );
        });
    });

    describe("sanitizeSecretId", () => {
        it("should lowercase and map SecretStorage-hostile characters to dashes", () => {
            expect(sanitizeSecretId("Authorization")).toBe("authorization");
            expect(sanitizeSecretId("X-API-KEY")).toBe("x-api-key");
            expect(sanitizeSecretId("BRAVE_API_KEY")).toBe("brave-api-key");
            expect(sanitizeSecretId("  Content-Type  ")).toBe("content-type");
        });

        it("should collapse repeated dashes and trim the ends", () => {
            expect(sanitizeSecretId("a  b")).toBe("a-b");
            expect(sanitizeSecretId("--x--")).toBe("x");
        });

        it("should cap the id at the requested length", () => {
            expect(sanitizeSecretId("abcdefghij", 5)).toBe("abcde");
            expect(sanitizeSecretId("key", 0)).toBe("");
        });

        it("should return an empty string when nothing valid remains", () => {
            expect(sanitizeSecretId("###")).toBe("");
        });
    });
});
