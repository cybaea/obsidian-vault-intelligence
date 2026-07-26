import type {
    OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
    OAuthClientInformationMixed,
    OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { logger } from "../../../utils/logger";

/**
 * OAuth tokens annotated with an absolute expiry timestamp.
 *
 * The MCP SDK's `OAuthTokens.expires_in` is a relative duration in seconds,
 * which is meaningless across Obsidian restarts (the process that issued the
 * token is long gone). `DefaultOAuthTokenStore.saveTokens` computes an
 * absolute `expires_at` (epoch milliseconds) at save time and persists both.
 * On load, `ObsidianOAuthClientProvider.tokens()` reconstructs a relative
 * `expires_in` from `expires_at` so the SDK's refresh logic sees the correct
 * remaining lifetime.
 */
export interface PersistedOAuthTokens extends OAuthTokens {
    readonly expires_at: number;
}

/**
 * Scope of credential invalidation.
 *
 * Mirrors the `invalidateCredentials` scope union on the SDK's
 * `OAuthClientProvider` so the store and provider stay aligned.
 */
export type InvalidationTokenScope = "all" | "client" | "discovery" | "tokens" | "verifier";

/**
 * Read/write surface for OAuth artifacts backed by Obsidian's
 * `SecretStorage`.
 *
 * Each artifact is stored under a deterministic key derived from the MCP
 * server id, following the existing `mcp-<server.id>-<scope>-` convention
 * used for environment-variable and header secrets (see
 * `src/settings/sections/mcp.ts`). All artifacts live in the device
 * keychain and are never written to the sync-persisted settings file or the
 * cold MessagePack store.
 *
 * Methods are declared as `Promise`-returning (not `async`) because the
 * underlying `SecretStorage` is synchronous and the project's
 * `@typescript-eslint/require-await` rule flags `async` methods that contain
 * no `await` expression. Wrapping the synchronous result in
 * `Promise.resolve` keeps the contract awaitable for future
 * `SecretStorage` implementations that may become asynchronous, without
 * forcing every caller to special-case the current synchronous behaviour.
 */
export interface OAuthTokenStore {
    invalidate(serverId: string, scope: InvalidationTokenScope): Promise<void>;
    loadClientInformation(serverId: string): Promise<OAuthClientInformationMixed | undefined>;
    loadClientSecret(serverId: string): Promise<string | undefined>;
    loadDiscoveryState(serverId: string): Promise<OAuthDiscoveryState | undefined>;
    loadTokens(serverId: string): Promise<PersistedOAuthTokens | undefined>;
    loadVerifier(serverId: string): Promise<string | undefined>;
    saveClientInformation(serverId: string, info: OAuthClientInformationMixed): Promise<void>;
    saveClientSecret(serverId: string, secret: string): Promise<void>;
    saveDiscoveryState(serverId: string, state: OAuthDiscoveryState): Promise<void>;
    saveTokens(serverId: string, tokens: OAuthTokens): Promise<void>;
    saveVerifier(serverId: string, verifier: string): Promise<void>;
}

/**
 * Minimal local view of Obsidian's `SecretStorage` surface.
 *
 * Obsidian's published `SecretStorage` interface declares only
 * `getSecret`. The `setSecret` and `clearSecret` methods exist on desktop
 * builds but are not part of the typed public API, so each consumer defines
 * its own local cast interface with runtime feature-checks (see
 * `GeminiProvider.ts:13-15`, `VoyageAIProvider.ts:17-20`,
 * `McpClientManager.ts:16-20`). This file follows the same convention rather
 * than sharing a cast type across providers.
 */
interface InternalSecretStorage {
    clearSecret?(key: string): void;
    getSecret(key: string): string | null;
    setSecret?(key: string, value: string): void;
}

/**
 * Returns the secret key prefix for a given server's OAuth artifacts.
 *
 * Exposed as a standalone function (rather than inlined) so tests and the
 * settings UI (which writes the optional client secret under the same key
 * the store reads) share a single source of truth for the key format.
 */
export function oauthSecretKey(serverId: string, suffix: string): string {
    return `mcp-${serverId}-oauth-${suffix}`;
}

const TOKENS_SUFFIX = "tokens";
const VERIFIER_SUFFIX = "verifier";
const CLIENT_SUFFIX = "client";
const CLIENT_SECRET_SUFFIX = "client-secret";
const DISCOVERY_SUFFIX = "discovery";

/**
 * Sentinel persisted in place of `expires_at` for non-expiring tokens
 * (servers that omit `expires_in`). `JSON.stringify(Number.POSITIVE_INFINITY)`
 * produces `null`, so a large finite value is used instead and restored to
 * `Infinity` on load by {@link DefaultOAuthTokenStore.readTokens}.
 */
const NEVER_EXPIRES_SENTINEL = Number.MAX_SAFE_INTEGER;

/**
 * Maps an invalidation scope to the set of secret-key suffixes that should be
 * cleared. `'all'` clears every OAuth artifact; the narrower scopes clear only
 * the relevant subset. The client secret is always cleared alongside the
 * client information because the two are persisted as a pair by
 * `ObsidianOAuthClientProvider.saveClientInformation`.
 */
function suffixesForScope(scope: InvalidationTokenScope): readonly string[] {
    switch (scope) {
        case "tokens":
            return [TOKENS_SUFFIX];
        case "verifier":
            return [VERIFIER_SUFFIX];
        case "client":
            return [CLIENT_SUFFIX, CLIENT_SECRET_SUFFIX];
        case "discovery":
            return [DISCOVERY_SUFFIX];
        case "all":
            return [TOKENS_SUFFIX, VERIFIER_SUFFIX, CLIENT_SUFFIX, CLIENT_SECRET_SUFFIX, DISCOVERY_SUFFIX];
        default: {
            // Exhaustiveness guard: if InvalidationTokenScope gains a member,
            // this default branch becomes reachable and TypeScript flags it.
            const _exhaustive: never = scope;
            void _exhaustive;
            return [];
        }
    }
}

/**
 * Default {@link OAuthTokenStore} implementation backed by Obsidian's
 * `SecretStorage`.
 *
 * The constructor takes the `SecretStorage`-bearing object directly (rather
 * than the full `App`) so the store is trivially mockable in tests with a
 * plain object. Production callers pass `app.secretStorage`.
 */
export class DefaultOAuthTokenStore implements OAuthTokenStore {
    private readonly storage: InternalSecretStorage;

    constructor(secretStorage: unknown) {
        this.storage = secretStorage as InternalSecretStorage;
    }

    loadTokens(serverId: string): Promise<PersistedOAuthTokens | undefined> {
        return Promise.resolve(this.readTokens(serverId));
    }

    saveTokens(serverId: string, tokens: OAuthTokens): Promise<void> {
        // `expires_in` is optional per RFC 6749 (some servers omit it for
        // non-expiring tokens). When absent, record `expires_at` as a large
        // finite sentinel so `tokens()` reconstructs a large `expires_in`
        // and the SDK does not attempt a refresh on a token the server
        // considers non-expiring. A finite sentinel is required because
        // `JSON.stringify(Number.POSITIVE_INFINITY)` emits `null`, which
        // would fail the `typeof expires_at === 'number'` shape check on
        // load and discard the tokens.
        const expiresAt = tokens.expires_in !== undefined
            ? Date.now() + tokens.expires_in * 1000
            : NEVER_EXPIRES_SENTINEL;
        const persisted: PersistedOAuthTokens = {
            access_token: tokens.access_token,
            expires_at: expiresAt,
            expires_in: tokens.expires_in,
            id_token: tokens.id_token,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope,
            token_type: tokens.token_type,
        };
        this.write(oauthSecretKey(serverId, TOKENS_SUFFIX), JSON.stringify(persisted));
        return Promise.resolve();
    }

    loadVerifier(serverId: string): Promise<string | undefined> {
        return Promise.resolve(this.read(oauthSecretKey(serverId, VERIFIER_SUFFIX)) ?? undefined);
    }

    saveVerifier(serverId: string, verifier: string): Promise<void> {
        this.write(oauthSecretKey(serverId, VERIFIER_SUFFIX), verifier);
        return Promise.resolve();
    }

    loadClientInformation(serverId: string): Promise<OAuthClientInformationMixed | undefined> {
        return Promise.resolve(this.readClientInformation(serverId));
    }

    saveClientInformation(serverId: string, info: OAuthClientInformationMixed): Promise<void> {
        // The client secret is persisted under its own key (see
        // `saveClientSecret`) so it can be cleared independently and the
        // `clientInformation` entry never contains the secret in plaintext
        // JSON. Strip it from the copy we serialize.
        const { client_secret: _stripped, ...withoutSecret } = info;
        void _stripped;
        this.write(oauthSecretKey(serverId, CLIENT_SUFFIX), JSON.stringify(withoutSecret));
        return Promise.resolve();
    }

    loadClientSecret(serverId: string): Promise<string | undefined> {
        return Promise.resolve(this.read(oauthSecretKey(serverId, CLIENT_SECRET_SUFFIX)) ?? undefined);
    }

    saveClientSecret(serverId: string, secret: string): Promise<void> {
        this.write(oauthSecretKey(serverId, CLIENT_SECRET_SUFFIX), secret);
        return Promise.resolve();
    }

    loadDiscoveryState(serverId: string): Promise<OAuthDiscoveryState | undefined> {
        return Promise.resolve(this.readDiscoveryState(serverId));
    }

    saveDiscoveryState(serverId: string, state: OAuthDiscoveryState): Promise<void> {
        this.write(oauthSecretKey(serverId, DISCOVERY_SUFFIX), JSON.stringify(state));
        return Promise.resolve();
    }

    invalidate(serverId: string, scope: InvalidationTokenScope): Promise<void> {
        for (const suffix of suffixesForScope(scope)) {
            this.clear(oauthSecretKey(serverId, suffix));
        }
        return Promise.resolve();
    }

    private readTokens(serverId: string): PersistedOAuthTokens | undefined {
        const raw = this.read(oauthSecretKey(serverId, TOKENS_SUFFIX));
        if (!raw) return undefined;
        try {
            const parsed = JSON.parse(raw) as PersistedOAuthTokens;
            // Validate the minimal shape so a corrupted entry does not crash
            // the SDK's auth flow. A missing access_token means the entry is
            // not usable; treat it as absent so the SDK re-authorizes.
            if (typeof parsed.access_token !== "string" || typeof parsed.expires_at !== "number") {
                return undefined;
            }
            // Restore the canonical non-expiring marker. The provider's
            // `tokens()` checks `Number.isFinite` and returns
            // `Number.MAX_SAFE_INTEGER` for the reconstructed `expires_in`
            // either way, so this normalization is invisible to the SDK, but
            // it keeps the in-memory representation honest.
            const expires_at = parsed.expires_at === NEVER_EXPIRES_SENTINEL
                ? Number.POSITIVE_INFINITY
                : parsed.expires_at;
            return { ...parsed, expires_at };
        } catch (e) {
            logger.error(`Failed to parse OAuth tokens for server ${serverId}`, e);
            return undefined;
        }
    }

    private readClientInformation(serverId: string): OAuthClientInformationMixed | undefined {
        const raw = this.read(oauthSecretKey(serverId, CLIENT_SUFFIX));
        if (!raw) return undefined;
        try {
            const parsed = JSON.parse(raw) as OAuthClientInformationMixed;
            if (typeof parsed.client_id !== "string") return undefined;
            return parsed;
        } catch (e) {
            logger.error(`Failed to parse OAuth client information for server ${serverId}`, e);
            return undefined;
        }
    }

    private readDiscoveryState(serverId: string): OAuthDiscoveryState | undefined {
        const raw = this.read(oauthSecretKey(serverId, DISCOVERY_SUFFIX));
        if (!raw) return undefined;
        try {
            const parsed = JSON.parse(raw) as OAuthDiscoveryState;
            if (typeof parsed.authorizationServerUrl !== "string") return undefined;
            return parsed;
        } catch (e) {
            logger.error(`Failed to parse OAuth discovery state for server ${serverId}`, e);
            return undefined;
        }
    }

    private read(key: string): string | null {
        if (!this.storage.getSecret) return null;
        try {
            return this.storage.getSecret(key);
        } catch (e) {
            logger.error(`Failed to read secret ${key}`, e);
            return null;
        }
    }

    private write(key: string, value: string): void {
        if (!this.storage.setSecret) {
            logger.warn(`SecretStorage does not support setSecret; cannot persist ${key}`);
            return;
        }
        try {
            this.storage.setSecret(key, value);
        } catch (e) {
            logger.error(`Failed to write secret ${key}`, e);
        }
    }

    private clear(key: string): void {
        if (!this.storage.clearSecret) {
            // Fallback: overwrite with an empty string when clearSecret is
            // unavailable (some Obsidian builds). This is best-effort and
            // leaves an empty entry rather than removing the key.
            if (this.storage.setSecret) {
                try {
                    this.storage.setSecret(key, "");
                } catch (e) {
                    logger.error(`Failed to clear secret ${key} via empty overwrite`, e);
                }
            }
            return;
        }
        try {
            this.storage.clearSecret(key);
        } catch (e) {
            logger.error(`Failed to clear secret ${key}`, e);
        }
    }
}