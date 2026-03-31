import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { resolveMcpSecrets } from "../../../src/services/mcp/utils";

describe("Mcp Transport Utils", () => {
    describe("resolveMcpSecrets", () => {
        let mockedGetSecretValue: Mock;

        beforeEach(() => {
            mockedGetSecretValue = vi.fn();
        });

        it("should return an empty object if rawMap is undefined", () => {
            expect(resolveMcpSecrets(undefined, mockedGetSecretValue)).toEqual({});
            expect(resolveMcpSecrets(null, mockedGetSecretValue)).toEqual({});
            expect(resolveMcpSecrets("", mockedGetSecretValue)).toEqual({});
        });

        it("should parse normal JSON string without secrets", () => {
            const rawMap = JSON.stringify({ KEY: "value", NUMBER: "123" });
            const result = resolveMcpSecrets(rawMap, mockedGetSecretValue);
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

            const result = resolveMcpSecrets(rawMap, mockedGetSecretValue);
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

            expect(() => resolveMcpSecrets(rawMap, mockedGetSecretValue)).toThrow(
                "Missing secret for API_KEY. Please re-enter it in settings."
            );
        });

        it("should throw an error with invalid JSON representation", () => {
            expect(() => resolveMcpSecrets("not valid json", mockedGetSecretValue)).toThrow(
                /Invalid JSON format in configuration/
            );
        });
    });
});
