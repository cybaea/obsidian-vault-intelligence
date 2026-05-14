import { RETRY_CONSTANTS } from "../constants";
import { ProviderError } from "../types/providers";
import { parseRetryAfterHeader } from "./headers";
import { logger } from "./logger";

/**
 * Executes an operation with exponential backoff and jittered retries.
 * Respects Retry-After headers and transient error status codes.
 */
export async function retryOperation<T>(
    operation: () => Promise<T>,
    provider: string,
    retries: number,
    loggerPrefix: string = provider
): Promise<T> {
    let lastError: Error | null = null;
    let delay = RETRY_CONSTANTS.INITIAL_DELAY_MS;
    const MAX_BACKOFF_MS = RETRY_CONSTANTS.MAX_BACKOFF_MS;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            const err = error as { 
                message?: string; 
                status?: number; 
                retryAfter?: number;
                response?: { headers?: Record<string, string> }
            };

            // Attempt to extract retry-after from SDK error response if available
            if (!err.retryAfter && err.response?.headers) {
                err.retryAfter = parseRetryAfterHeader(err.response.headers);
            }

            // Check if error is transient (Rate limit 429, or server errors 503, 504, or network failure)
            const isTransientError = 
                err.status === 429 || 
                err.message?.includes("429") || 
                err.status === 503 || 
                err.status === 504 || 
                err.message?.includes("Failed to fetch");

            if (isTransientError) {
                // Use server-provided retry-after if available, otherwise use our backoff
                const retryAfterMs = err.retryAfter ? err.retryAfter * 1000 : delay;
                
                // Add jitter (±10%) to prevent thundering herd
                const jitter = 0.9 + Math.random() * 0.2;
                const finalDelay = Math.min(retryAfterMs * jitter, MAX_BACKOFF_MS);

                logger.warn(`[${loggerPrefix}] Transient error (${err.message || "unknown"}). Retrying in ${Math.round(finalDelay)}ms...`);
                
                lastError = error instanceof Error ? error : new Error(String(error));
                await new Promise(resolve => window.setTimeout(resolve, finalDelay));
                
                // Only increase our internal delay if the server didn't specify a time
                if (!err.retryAfter) {
                    delay = Math.min(delay * 2, MAX_BACKOFF_MS);
                }
            } else {
                // Not a transient error, re-throw immediately
                if (error instanceof ProviderError) {
                    throw error;
                }
                const message = err.message || "Unknown error occurred";
                const status = err.status;
                throw new ProviderError(message, provider, status);
            }
        }
    }
    throw lastError || new ProviderError("Max retries reached.", provider, 429);
}
