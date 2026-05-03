import { VaultIntelligenceSettings } from "../settings/types";

export const GOOGLE_API_KEY_SECRET_NAME = 'vault-intelligence-api-key';

export function getGoogleApiKeySecretName(settings: VaultIntelligenceSettings): string | null {
    if (settings.googleApiKeySecret) {
        return settings.googleApiKeySecret;
    }
    if (settings.googleApiKey && !settings.googleApiKey.startsWith('AIza')) {
        return settings.googleApiKey;
    }
    return null;
}

export function hasGoogleApiKey(settings: VaultIntelligenceSettings): boolean {
    return !!settings.googleApiKey || !!settings.googleApiKeySecret;
}

/**
 * Resolve secret placeholders in a JSON-stringified key-value map.
 * 
 * @param rawMap - JSON-stringified map with potential `vi-secret:${key}` placeholders
 * @param getSecretValue - Callback to retrieve actual secret values from keychain
 * @param secretKeyPrefix - Prefix for secret storage (e.g., "ollama-headers-", "mcp-env-")
 * @returns Resolved map with actual values
 */
export async function resolveSecrets(
    rawMap: string | undefined | null,
    getSecretValue: (key: string) => string | null | Promise<string | null>,
    secretKeyPrefix: string
): Promise<Record<string, string>> {
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
            // Ensure we use the correct key with prefix for the storage lookup
            const fullSecretKey = `${secretKeyPrefix}${secretKey}`;
            const secretVal = await getSecretValue(fullSecretKey);
            
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