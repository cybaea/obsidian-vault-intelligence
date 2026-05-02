import { resolveSecrets } from "../../utils/secrets";

/**
 * @deprecated Use resolveSecrets from src/utils/secrets.ts instead
 */
export const resolveMcpSecrets = (
    rawMap: string | undefined | null,
    getSecretValue: (key: string) => string | Promise<string | null>,
    secretKeyPrefix: string = 'mcp-env-'
) => resolveSecrets(rawMap, getSecretValue, secretKeyPrefix);
