/**
 * Restricted headers that users cannot configure (protocol-level safety).
 */
const RESTRICTED_HEADERS = new Set([
    'host', 'content-length', 'transfer-encoding', 'connection',
    'upgrade', 'expect', 'te', 'trailer',
    'proxy-authenticate', 'proxy-authorization', 'keep-alive'
].map(h => h.toLowerCase()));

/**
 * Validate a header key is safe and allowed.
 *  @returns { valid: boolean; error?: string }
 */
export function validateHeaderKey(key: string): { valid: boolean; error?: string } {
    if (!key || typeof key !== 'string') {
        return { error: 'Header key must be a non-empty string', valid: false };
    }
    
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
        return { error: 'Header key contains invalid characters (only alphanumeric, underscore, hyphen allowed)', valid: false };
    }
    
    if (RESTRICTED_HEADERS.has(key.toLowerCase())) {
        return { error: `Header '${key}' is restricted (protocol-level)`, valid: false };
    }
    
    return { valid: true };
}

/**
 *   Validate and sanitize a complete headers object.
 * Removes restricted headers and logs warnings.
 */
export function sanitizeHeaders(
    headers: Record<string, string>,
    logger: { warn: (msg: string) => void }
): Record<string, string> {
    const sanitized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
        const validation = validateHeaderKey(key);
        if (!validation.valid) {
            logger.warn(`[Headers] Skipping ${key}: ${validation.error}`);
            continue;
        }
        sanitized[key] = value;
    }
    
    return sanitized;
}

/**
 *   Merge multiple header objects (custom > defaults).
 * Uses case-insensitive key matching (last one wins).
 */
export function mergeHeaders(...headersList: Array<Record<string, string> | undefined>): Record<string, string> {
    const merged: Record<string, string> = {};
    const keyMap: Record<string, string> = {}; // lowercase -> actual case
    
    for (const headers of headersList) {
        if (!headers) continue;
        for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            const existingKey = keyMap[lowerKey];
            if (existingKey) {
                delete merged[existingKey];
            }
            merged[key] = value;
            keyMap[lowerKey] = key;
        }
    }
    
    return merged;
}
