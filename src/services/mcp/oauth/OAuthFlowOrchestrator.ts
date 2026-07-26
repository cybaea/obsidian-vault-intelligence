import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import type { DesktopOAuthReceiver, OAuthRedirectError, OAuthRedirectResult } from "./DesktopOAuthReceiver";
import type { ObsidianOAuthClientProvider } from "./ObsidianOAuthClientProvider";

/**
 * Outcome of an OAuth flow attempt.
 *
 * - `'authorized'`: the server has a usable access token (either an
 *   existing valid token was reused, or the browser consent flow
 *   completed and the token exchange succeeded) and the MCP client
 *   connection was re-established.
 * - `'redirect'`: the SDK's `auth()` returned `'REDIRECT'` but no
 *   receiver was started (or the browser flow was not awaited). This
 *   is an intermediate state that the orchestrator resolves into
 *   `'authorized'` or `'error'` once the redirect lands.
 * - `'error'`: the flow failed. `errorMessage` carries a
 *   user-presentable message (the receiver timeout, a CSRF state
 *   mismatch, the user denying consent, or a token-exchange failure).
 */
export interface OAuthFlowResult {
    readonly errorMessage?: string;
    readonly status: 'authorized' | 'error' | 'redirect';
}

/**
 * Minimal client surface the orchestrator drives for the retry
 * connection after a successful token exchange.
 *
 * Modeled as a structural interface so tests can substitute a fake
 * without binding to the concrete SDK `Client` class.
 */
export interface OAuthClientLike {
    connect(transport: unknown): Promise<void>;
}

/**
 * Minimal transport surface the orchestrator needs: `finishAuth`
 * exchanges the authorization code for tokens. The concrete SDK
 * transports (`StreamableHTTPClientTransport`, `SSEClientTransport`)
 * both implement this.
 */
export interface OAuthTransportLike {
    finishAuth(authorizationCode: string): Promise<void>;
}

/**
 * Orchestrates the interactive OAuth 2.0 authorization-code-with-PKCE
 * flow for a single MCP server.
 *
 * The orchestrator is the glue between the SDK's `auth()` helper, the
 * loopback receiver (browser redirect capture), and the SDK transport's
 * `finishAuth` (token exchange). It is constructed by
 * `McpClientManager.connectOAuthServer` after the transport strategy
 * throws `UnauthorizedError` on the initial connection attempt.
 *
 * Flow:
 *  1. Generate a CSRF `state` via the provider.
 *  2. Start the loopback receiver to capture the redirect.
 *  3. Set `provider.redirectUrl` to the receiver's URL so the SDK's
 *     `auth()` builds the authorization URL with the correct
 *     `redirect_uri`.
 *  4. Call SDK `auth()`. If a valid token already exists, it returns
 *     `'AUTHORIZED'` and no browser flow is needed. Otherwise it calls
 *     `provider.redirectToAuthorization` (opens the browser) and
 *     returns `'REDIRECT'`.
 *  5. Await the receiver's `waitForCode` promise (the browser
 *     redirect).
 *  6. Call `transport.finishAuth(code)` to exchange the code for
 *     tokens (the SDK persists them via `provider.saveTokens`).
 *  7. Retry `client.connect(transport)` with the new token.
 *
 * Errors at every stage are funneled into an `'error'` result so the
 * caller (`McpClientManager`) can surface a single message to the UI.
 */
export class OAuthFlowOrchestrator {
    constructor(
        private readonly provider: ObsidianOAuthClientProvider,
        private readonly receiver: DesktopOAuthReceiver,
        private readonly transport: OAuthTransportLike,
        private readonly client: OAuthClientLike,
        private readonly sdkTransport: unknown,
        private readonly serverUrl: string,
        private readonly fetchFn: FetchLike,
    ) {}

    public async authorize(): Promise<OAuthFlowResult> {
        // 1. CSRF state + receiver start. The receiver binds a
        //    loopback port and reports the redirect URL the SDK will
        //    advertise to the authorization server.
        const state = await this.provider.state();
        const { redirectUrl, waitForCode } = await this.receiver.start(state);
        this.provider.setRedirectUrl(redirectUrl.toString());

        // 2. Drive the SDK auth flow. With no authorizationCode, this
        //    performs discovery + (refresh or redirect). A valid stored
        //    token yields 'AUTHORIZED' without opening a browser.
        const authResult = await auth(this.provider, {
            fetchFn: this.fetchFn,
            serverUrl: this.serverUrl,
        });

        if (authResult === 'AUTHORIZED') {
            // The stored token was still valid (or was refreshed
            // silently). No browser flow needed; tear down the
            // receiver and signal success.
            await this.receiver.stop();
            return { status: 'authorized' };
        }

        // 3. 'REDIRECT': the browser is opening (or about to open)
        //    via provider.redirectToAuthorization. Await the loopback
        //    redirect, exchange the code, and retry the connection.
        try {
            const result: OAuthRedirectResult = await waitForCode;
            // 4. Exchange the authorization code for tokens. The SDK
            //    persists the tokens via provider.saveTokens.
            await this.transport.finishAuth(result.code);
            // 5. Retry the MCP client connection with the new token.
            await this.client.connect(this.sdkTransport);
            return { status: 'authorized' };
        } catch (error) {
            return {
                errorMessage: errorMessage(error),
                status: 'error',
            };
        } finally {
            await this.receiver.stop();
        }
    }
}

/**
 * Extracts a human-readable message from an OAuth flow error.
 *
 * The receiver rejects `waitForCode` with either an `OAuthRedirectError`
 * (carrying `error`/`errorDescription` from the authorization server)
 * or a plain `Error` (timeout, CSRF mismatch). The SDK `finishAuth` and
 * `client.connect` throw plain `Error`s on token-exchange or transport
 * failures. Non-Error rejections are stringified defensively.
 */
function errorMessage(error: unknown): string {
    if (isRedirectError(error)) {
        return error.errorDescription
            ? `OAuth denied: ${error.error} (${error.errorDescription})`
            : `OAuth denied: ${error.error}`;
    }
    return error instanceof Error ? error.message : String(error);
}

/**
 * Narrows an unknown error to {@link OAuthRedirectError}.
 *
 * `OAuthRedirectError` is created via `Object.defineProperty` on a plain
 * `Error` base, so `instanceof` cannot be relied upon across module
 * boundaries (and the error may be a structural copy in tests). The
 * presence of the readonly `error` string property is the reliable
 * discriminator.
 */
function isRedirectError(error: unknown): error is OAuthRedirectError {
    return typeof error === 'object'
        && error !== null
        && 'error' in error
        && typeof (error).error === 'string';
}