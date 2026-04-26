import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { resolveSecrets } from "../../src/utils/secrets";

describe("Secrets Utils", () => {
    describe("resolveSecrets", () => {
        let mockedGetSecretValue: Mock;

        beforeEach(() => {
            mockedGetSecretValue = vi.fn();
        });

        it("should return an empty object if rawMap is undefined", () => {
            expect(resolveSecrets(undefined, mockedGetSecretValue)).toEqual({});
            expect(resolveSecrets(null, mockedGetSecretValue)).toEqual({});
            expect(resolveSecrets("", mockedGetSecretValue)).toEqual({});
        });

        it("should parse normal JSON string without secrets", () => {
            const rawMap = JSON.stringify({ KEY: "value", NUMBER: "123" });
            const result = resolveSecrets(rawMap, mockedGetSecretValue);
            expect(result).toEqual({ KEY: "value", NUMBER: "123" });
            expect(mockedGetSecretValue).not.toHaveBeenCalled();
        });

        it("should substitute secrets starting with vi-secret:", () => {
            const rawMap = JSON.stringify({ 
                API_KEY: "vi-secret:my-api-key",
                NORMAL: "text"
            });
            mockedGetSecretValue.mockImplementation((key: string) => {
                if (key === "my-api-key") return "resolved-secret-value";
                return null;
            });

            const result = resolveSecrets(rawMap, mockedGetSecretValue);
            expect(result).toEqual({ 
                API_KEY: "resolved-secret-value",
                NORMAL: "text"
            });
            expect(mockedGetSecretValue).toHaveBeenCalledWith("my-api-key");
        });

        it("should throw an error if a secret is missing", () => {
            const rawMap = JSON.stringify({ 
                API_KEY: "vi-secret:missing-api-key"
            });
            mockedGetSecretValue.mockReturnValue(null);

            expect(() => resolveSecrets(rawMap, mockedGetSecretValue)).toThrow(
                "Missing secret for API_KEY. Please re-enter it in settings."
            );
        });

        it("should throw an error with invalid JSON representation", () => {
            expect(() => resolveSecrets("not valid json", mockedGetSecretValue)).toThrow(
                /Invalid JSON format in configuration/
            );
        });
    });
});
