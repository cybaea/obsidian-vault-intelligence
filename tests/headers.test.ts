import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseRetryAfterHeader } from "../src/utils/headers";

describe("parseRetryAfterHeader", () => {
    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-14T18:00:00Z"));
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("should parse integer seconds", () => {
        expect(parseRetryAfterHeader({ "retry-after": "30" })).toBe(30);
    });

    it("should be case-insensitive", () => {
        expect(parseRetryAfterHeader({ "Retry-After": "45" })).toBe(45);
    });

    it("should parse HTTP-date format", () => {
        const dateStr = "Thu, 14 May 2026 18:00:30 GMT";
        expect(parseRetryAfterHeader({ "retry-after": dateStr })).toBe(30);
    });

    it("should return 0 for dates in the past", () => {
        const dateStr = "Thu, 14 May 2026 17:59:00 GMT";
        expect(parseRetryAfterHeader({ "retry-after": dateStr })).toBe(0);
    });

    it("should return undefined if header is missing", () => {
        expect(parseRetryAfterHeader({})).toBeUndefined();
    });

    it("should return undefined for invalid formats", () => {
        expect(parseRetryAfterHeader({ "retry-after": "not-a-date" })).toBeUndefined();
    });
});
