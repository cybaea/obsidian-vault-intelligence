import { describe, it, expect } from "vitest";

import { isExternalUrl } from "./url";

describe("isExternalUrl", () => {
    describe("Default Mode (allowLocal = false)", () => {
        it("should allow public URLs", () => {
            expect(isExternalUrl("https://google.com")).toBe(true);
            expect(isExternalUrl("http://example.org/path")).toBe(true);
        });

        it("should block localhost and loopback", () => {
            expect(isExternalUrl("http://localhost")).toBe(false);
            expect(isExternalUrl("http://127.0.0.1")).toBe(false);
            expect(isExternalUrl("http://127.0.0.5")).toBe(false);
            expect(isExternalUrl("http://[::1]")).toBe(false);
        });

        it("should block private IP ranges", () => {
            expect(isExternalUrl("http://192.168.1.1")).toBe(false);
            expect(isExternalUrl("http://10.0.0.1")).toBe(false);
            expect(isExternalUrl("http://172.16.0.1")).toBe(false);
            expect(isExternalUrl("http://172.31.255.255")).toBe(false);
        });

        it("should block 'Any' addresses", () => {
            expect(isExternalUrl("http://0.0.0.0")).toBe(false);
            expect(isExternalUrl("http://[::]")).toBe(false);
        });

        it("should block metadata services", () => {
            expect(isExternalUrl("http://169.254.169.254")).toBe(false);
        });

        it("should block non-http protocols", () => {
            expect(isExternalUrl("ftp://google.com")).toBe(false);
            expect(isExternalUrl("file:///etc/passwd")).toBe(false);
            expect(isExternalUrl("javascript:alert(1)")).toBe(false);
        });
    });

    describe("Opt-In Mode (allowLocal = true)", () => {
        it("should allow localhost and loopback", () => {
            expect(isExternalUrl("http://localhost", true)).toBe(true);
            expect(isExternalUrl("http://127.0.0.1", true)).toBe(true);
            expect(isExternalUrl("http://[::1]", true)).toBe(true);
        });

        it("should allow private IP ranges", () => {
            expect(isExternalUrl("http://192.168.1.1", true)).toBe(true);
            expect(isExternalUrl("http://10.0.0.1", true)).toBe(true);
        });

        it("should allow 'Any' addresses", () => {
            expect(isExternalUrl("http://0.0.0.0", true)).toBe(true);
            expect(isExternalUrl("http://[::]", true)).toBe(true);
        });

        it("should STILL block metadata services (Hard Block)", () => {
            expect(isExternalUrl("http://169.254.169.254", true)).toBe(false);
        });

        it("should STILL block non-http protocols (Hard Block)", () => {
            expect(isExternalUrl("ftp://google.com", true)).toBe(false);
            expect(isExternalUrl("file:///etc/passwd", true)).toBe(false);
        });
    });

    it("should handle invalid URLs safely", () => {
        expect(isExternalUrl("not-a-url")).toBe(false);
    });
});
