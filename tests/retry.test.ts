import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { retryOperation } from "../src/utils/retry";
import { ProviderError } from "../src/types/providers";

vi.mock("../src/utils/logger", () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
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

        // We must advance timers to allow the retry logic to progress
        await vi.runAllTimersAsync();
        
        // Wait for the final rejection
        await expect(promise).rejects.toThrow(ProviderError);
        expect(op).toHaveBeenCalledTimes(2);
    });

    it("should fail immediately on non-transient errors", async () => {
        const op = vi.fn().mockRejectedValue(new Error("Bad Request"));
        await expect(retryOperation(op, "test", 3)).rejects.toThrow(ProviderError);
        expect(op).toHaveBeenCalledTimes(1);
    });

    it("should respect Retry-After header if available", async () => {
        const error: any = new Error("Rate limit 429");
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
