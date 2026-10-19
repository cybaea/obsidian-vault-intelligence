import { VaultIntelligenceSettings } from "../settings/types";

export const GOOGLE_API_KEY_SECRET_NAME = 'vault-intelligence-api-key';
export const VOYAGE_API_KEY_SECRET_NAME = 'vault-intelligence-voyage-api-key';

/** Prefix that marks a stored header or env value as a keychain reference. */
export const VI_SECRET_PREFIX = 'vi-secret:';

/** Obsidian's SecretStorage rejects ids longer than 64 characters. */
export const SECRET_ID_MAX_LENGTH = 64;

/**
 * Sanitises a header or environment key into an id that Obsidian's
 * SecretStorage accepts (`[a-z0-9-]+`, at most 64 characters long).
 * Obsidian's `setSecret` throws "Invalid secret ID" for anything else, and
 * the original callers planted mixed-case payloads like `vi-secret:Authorization`,
 * which could never be stored; the sanitised payload is deterministic and a
 * no-op for already-valid ids, so historical lowercase references keep
 * resolving unchanged. Header names are case-insensitive, so `Authorization`
 * and `authorization` naturally share the resolved id.
 *
 * @param raw - The header or env key to turn into a SecretStorage id.
 * @param maxLength - Cap for the returned id; callers pass the remaining
 * budget after their resolver prefix so the full id stays within the limit.
 * @returns The sanitised id, or an empty string when nothing valid remains
 * (callers should skip the row and surface an error in that case).
 */
export function sanitizeSecretId(raw: string, maxLength: number = SECRET_ID_MAX_LENGTH): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, Math.max(0, maxLength));
}

export function getGoogleApiKeySecretName(settings: VaultIntelligenceSettings): string | null {
    if (settings.googleApiKeySecret) {
        return settings.googleApiKeySecret;
    }
    if (settings.googleApiKey && !settings.googleApiKey.startsWith('AIza')) {
        return settings.googleApiKey;
    }
    return null;
}

export function getVoyageApiKeySecretName(settings: VaultIntelligenceSettings): string | null {
    if (settings.voyageApiKeySecret) {
        return settings.voyageApiKeySecret;
    }
    if (settings.voyageApiKey && !settings.voyageApiKey.startsWith('pa-') && !settings.voyageApiKey.startsWith('al-')) {
        return settings.voyageApiKey;
    }
    return null;
}

export function isVoyageApiKey(key: string): boolean {
    return key.startsWith('pa-') || key.startsWith('al-');
}

export function hasGoogleApiKey(settings: VaultIntelligenceSettings): boolean {
    return !!settings.googleApiKey || !!settings.googleApiKeySecret;
}

export function hasVoyageApiKey(settings: VaultIntelligenceSettings): boolean {
    return !!settings.voyageApiKey || !!settings.voyageApiKeySecret;
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
        if (typeof v === 'string' && v.startsWith(VI_SECRET_PREFIX)) {
            const secretKey = v.substring(VI_SECRET_PREFIX.length);
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