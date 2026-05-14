import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ProviderError } from "../src/types/providers";
import { retryOperation } from "../src/utils/retry";

vi.mock("../src/utils/logger", () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
    }
}));

describe("retryOperation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("should return result on first success", async () => {
        const op = vi.fn().mockResolvedValue("success");
        const result = await retryOperation(op, "test", 3);
        expect(result).toBe("success");
        expect(op).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient errors and eventually succeed", async () => {
        const op = vi.fn()
            .mockRejectedValueOnce(new Error("Rate limit 429"))
            .mockResolvedValueOnce("success");

        const promise = retryOperation(op, "test", 3);
        
        await vi.runAllTimersAsync();
        
        const result = await promise;
        expect(result).toBe("success");
        expect(op).toHaveBeenCalledTimes(2);
    });

    it("should throw ProviderError after max retries", async () => {
        const op = vi.fn().mockRejectedValue(new Error("Rate limit 429"));
        
        const promise = retryOperation(op, "test", 2);
        // Catch it immediately to prevent unhandled rejection
        const errorPromise = promise.catch((e: unknown) => e);
        
        await vi.runAllTimersAsync();
        
        const error = await errorPromise;
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.status).toBe(429);
        expect(op).toHaveBeenCalledTimes(2);
    });

    it("should fail immediately on non-transient errors", async () => {
        const op = vi.fn().mockRejectedValue(new Error("Bad Request"));
        
        const promise = retryOperation(op, "test", 3);
        const errorPromise = promise.catch((e: unknown) => e);

        const error = await errorPromise;
        expect(error).toBeInstanceOf(ProviderError);
        expect(op).toHaveBeenCalledTimes(1);
    });

    it("should respect Retry-After header if available", async () => {
        interface MockError extends Error {
            response?: { headers?: Record<string, string> };
            status?: number;
        }
        const error = new Error("Rate limit 429") as MockError;
        error.status = 429;
        error.response = { headers: { "retry-after": "10" } };
        
        const op = vi.fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce("success");

        const promise = retryOperation(op, "test", 3);
        
        await vi.runAllTimersAsync();
        
        const result = await promise;
        expect(result).toBe("success");
        expect(op).toHaveBeenCalledTimes(2);
    });
});
