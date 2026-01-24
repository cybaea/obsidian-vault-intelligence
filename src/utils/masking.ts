/**
 * Masks a sensitive string (like an API key) for safe logging.
 * Shows the first 4 and last 4 characters, with dots in between.
 * 
 * @param secret - The sensitive string to mask.
 * @returns A masked version of the secret.
 */
export function maskSecret(secret: string | null | undefined): string {
    if (!secret) return "None";
    if (secret.length <= 8) return "****";
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

/**
 * Recursively masks sensitive keys in an object.
 * 
 * @param obj - The object to mask.
 * @param sensitiveKeys - List of keys whose values should be masked.
 * @returns A new object with sensitive values masked.
 */
export function maskObject(obj: Record<string, unknown>, sensitiveKeys: string[] = ['googleApiKey']): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (sensitiveKeys.includes(key) && typeof val === 'string') {
                masked[key] = maskSecret(val);
            } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                masked[key] = maskObject(val as Record<string, unknown>, sensitiveKeys);
            } else {
                masked[key] = val;
            }
        }
    }
    return masked;
}
