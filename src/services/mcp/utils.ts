/**
 * Resolves a dictionary of configuration strings (such as environment variables or headers)
 * by substituting placeholders in the format "vi-secret:SECRET_KEY" with the actual secret values.
 * 
 * @param rawMap The JSON-stringified map or raw object. If stringified format is invalid, throws an error.
 * @param getSecretValue Callback to resolve actual secret values by key.
 * @returns A safe map with secrets substituted.
 */
export function resolveMcpSecrets(
    rawMap: string | undefined | null,
    getSecretValue: (key: string) => string | null
): Record<string, string> {
    if (!rawMap) return {};
    
    let parsed: Record<string, string>;
    try {
        parsed = JSON.parse(rawMap) as Record<string, string>;
    } catch (e) {
        throw new Error(`Invalid JSON format in configuration: ${e instanceof Error ? e.message : String(e)}`);
    }

    const resolved: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.startsWith('vi-secret:')) {
            const secretKey = v.substring(10);
            const secretVal = getSecretValue(secretKey);
            if (secretVal === null) {
                // Return an error message but never log the secret key broadly.
                throw new Error(`Missing secret for ${k}. Please re-enter it in settings.`);
            }
            resolved[k] = secretVal;
        } else {
            resolved[k] = v;
        }
    }

    return resolved;
}
