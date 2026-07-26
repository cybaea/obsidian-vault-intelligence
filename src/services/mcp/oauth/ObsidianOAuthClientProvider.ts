import type {
    OAuthClientProvider,
    OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
    OAuthClientInformationMixed,
    OAuthClientMetadata,
    OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { logger } from "../../../utils/logger";
import {
    InvalidationTokenScope,
    OAuthTokenStore,
} from "./OAuthTokenStore";

/**
 * Default OAuth client name advertised to authorization servers.
 *
 * Matches the plugin id/brand so resource owners see a recognizable client
 * name on the consent screen.
 */
const CLIENT_NAME = "vault-intelligence";

/**
 * Converts a `Uint8Array` to a lowercase hex string.
 *
 * Used by `state()` to build the CSRF token from `crypto.getRandomValues`.
 * Kept module-local so the provider body stays focused on the SDK contract.
 */
function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * SDK `OAuthClientProvider` implementation that persists OAuth artifacts via
 * an {@link OAuthTokenStore} (Obsidian `SecretStorage`-backed) and opens the
 * system browser using the existing codebase convention (`window.open`).
 *
 * The orchestrator ({@link OAuthFlowOrchestrator}, Phase 4) constructs one
 * instance per OAuth-gated server, sets the loopback `redirectUrl` after
 * starting the receiver, then hands the provider to the SDK's `auth()`.
 *
 * Design notes:
 *
 * - `redirectUrl` is a getter over a value set by the orchestrator via
 *   {@link setRedirectUrl}. The SDK reads `provider.redirectUrl` when building
 *   the authorization URL, so the receiver must be started (and the URL
 *   captured) before `auth()` is called. We do NOT mutate `redirectUrl`
 *   inside `redirectToAuthorization` — that method only opens the browser.
 *
 * - `tokens()` reconstructs a relative `expires_in = max(0, expires_at - now)`
 *   from the absolute `expires_at` persisted by the store. This lets the
 *   SDK see the real remaining lifetime across restarts and trigger its own
 *   refresh flow when the access token has expired. Proactively refreshing
 *   inside `tokens()` would race with the SDK's refresh logic.
 *
 * - `redirectToAuthorization` returns `void` after opening the browser. It
 *   does NOT capture the authorization code — that is the loopback
 *   receiver's job. This matches the SDK contract (`void | Promise<void>`,
 *   verified at `client/auth.d.ts:62`).
 *
 * - `state()` generates a 16-byte random hex string (32 hex chars). The
 *   loopback receiver validates the `state` query parameter against this
 *   value (CSRF defense).
 *
 * - `clientMetadata.token_endpoint_auth_method` is `"none"` (public client)
 *   by default. If the user supplied a client secret, `clientInformation()`
 *   merges it in from separate storage and the SDK's
 *   `selectClientAuthMethod` picks `client_secret_basic` or
 *   `client_secret_post` automatically.
 */
export class ObsidianOAuthClientProvider implements OAuthClientProvider {
    private redirectUrlValue: string | undefined;
    private readonly serverId: string;
    private readonly store: OAuthTokenStore;

    constructor(serverId: string, store: OAuthTokenStore) {
        this.serverId = serverId;
        this.store = store;
    }

    /**
     * The loopback redirect URL the orchestrator captured from the receiver.
     *
     * Returns `undefined` until {@link setRedirectUrl} is called (the
     * orchestrator does this after starting the receiver and before invoking
     * SDK `auth()`).
     */
    get redirectUrl(): string | URL | undefined {
        return this.redirectUrlValue;
    }

    /**
     * Captures the loopback redirect URL reported by the receiver.
     *
     * Called by {@link OAuthFlowOrchestrator} after `receiver.start()` returns
     * the OS-assigned port and before SDK `auth()` is invoked.
     */
    setRedirectUrl(url: string): void {
        this.redirectUrlValue = url;
    }

    get clientMetadata(): OAuthClientMetadata {
        // `redirect_uris` is `string[]` per the SDK's inferred
        // `OAuthClientMetadata` type (verified against the .d.ts). The SDK
        // accepts either `URL[]` or `string[]` at runtime; the type narrows
        // to `string[]` here so we pass plain strings.
        return {
            client_name: CLIENT_NAME,
            grant_types: ["authorization_code", "refresh_token"],
            redirect_uris: this.redirectUrlValue ? [this.redirectUrlValue] : [],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        };
    }

    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
        const info = await this.store.loadClientInformation(this.serverId);
        if (!info) return undefined;
        // Merge the client secret from its own storage key. The secret is
        // stored separately (never inline in the `clientInformation` JSON)
        // so it can be cleared independently and is never leaked via the
        // sync-persisted config.
        const secret = await this.store.loadClientSecret(this.serverId);
        if (secret) {
            return { ...info, client_secret: secret };
        }
        return info;
    }

    async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
        await this.store.saveClientInformation(this.serverId, info);
        if (info.client_secret) {
            await this.store.saveClientSecret(this.serverId, info.client_secret);
        }
    }

    async tokens(): Promise<OAuthTokens | undefined> {
        const persisted = await this.store.loadTokens(this.serverId);
        if (!persisted) return undefined;
        // Reconstruct a relative `expires_in` from the absolute `expires_at`
        // so the SDK sees the real remaining lifetime across restarts. A
        // non-expiring token (expires_at = Infinity) yields a very large
        // `expires_in`, which the SDK treats as "not yet due for refresh".
        const now = Date.now();
        const remainingMs = persisted.expires_at - now;
        const expires_in = Number.isFinite(remainingMs)
            ? Math.max(0, Math.floor(remainingMs / 1000))
            : Number.MAX_SAFE_INTEGER;
        return {
            access_token: persisted.access_token,
            expires_in,
            id_token: persisted.id_token,
            refresh_token: persisted.refresh_token,
            scope: persisted.scope,
            token_type: persisted.token_type,
        };
    }

    async saveTokens(tokens: OAuthTokens): Promise<void> {
        await this.store.saveTokens(this.serverId, tokens);
    }

    /**
     * Opens the authorization URL in a new browser tab.
     *
     * Follows the existing codebase convention (`ReleaseNotesModal.ts`,
     * `connections.ts`) of `window.open(url, "_blank")`. Does NOT capture
     * the authorization code — that is the loopback receiver's job.
     */
    redirectToAuthorization(authorizationUrl: URL): Promise<void> {
        window.open(authorizationUrl.toString(), "_blank");
        return Promise.resolve();
    }

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        await this.store.saveVerifier(this.serverId, codeVerifier);
    }

    async codeVerifier(): Promise<string> {
        const verifier = await this.store.loadVerifier(this.serverId);
        if (!verifier) {
            throw new Error("Missing PKCE code verifier for MCP server " + this.serverId);
        }
        return verifier;
    }

    /**
     * Generates a random 16-byte (32 hex char) OAuth state parameter.
     *
     * The loopback receiver validates the `state` query parameter of the
     * browser redirect against this value (CSRF defense).
     */
    state(): Promise<string> {
        // `crypto.getRandomValues` is available in both the Obsidian desktop
        // (Chromium) and mobile (Capacitor) webviews, so no Node fallback is
        // needed. The provider is desktop-only in practice (the orchestrator
        // guards on `Platform.isDesktopApp`), but this method stays
        // platform-agnostic so it is unit-testable without mocking `Platform`.
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Promise.resolve(toHex(arr));
    }

    async invalidateCredentials(scope: InvalidationTokenScope): Promise<void> {
        await this.store.invalidate(this.serverId, scope);
    }

    async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
        await this.store.saveDiscoveryState(this.serverId, state);
        logger.info(`Saved OAuth discovery state for server ${this.serverId}`);
    }

    async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
        return this.store.loadDiscoveryState(this.serverId);
    }
}