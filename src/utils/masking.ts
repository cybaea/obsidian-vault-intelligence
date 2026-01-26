/**
 * Computes a one-way fingerprint of a secret using SHA-256.
 * Returns a hex-encoded string of the first 16 characters of the hash.
 * 
 * @param secret - The secret to fingerprint.
 * @returns A promise resolving to the fingerprint string.
 */
async function getFingerprint(secret: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(secret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.slice(0, 16);
}

/**
 * Masks a sensitive string (like an API key) using a one-way fingerprint for safe logging.
 * Returns "sha256:<fingerprint>".
 * 
 * @param secret - The sensitive string to mask.
 * @returns A promise resolving to a masked version of the secret.
 */
export async function maskSecret(secret: string | null | undefined): Promise<string> {
    if (!secret) return "None";
    const fingerprint = await getFingerprint(secret);
    return `sha256:${fingerprint}`;
}

/**
 * Recursively masks sensitive keys in an object using fingerprints.
 * 
 * @param obj - The object to mask.
 * @param sensitiveKeys - List of keys whose values should be masked.
 * @returns A promise resolving to a new object with sensitive values masked.
 */
export async function maskObject(obj: Record<string, unknown>, sensitiveKeys: string[] = ['googleApiKey']): Promise<Record<string, unknown>> {
    const masked: Record<string, unknown> = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (sensitiveKeys.includes(key) && typeof val === 'string') {
                masked[key] = await maskSecret(val);
            } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                masked[key] = await maskObject(val as Record<string, unknown>, sensitiveKeys);
            } else {
                masked[key] = val;
            }
        }
    }
    return masked;
}
