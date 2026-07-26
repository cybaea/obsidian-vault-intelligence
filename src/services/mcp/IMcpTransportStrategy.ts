import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { MCPServerConfig } from "../../settings/types";

export interface McpConnectionResult {
    client: Client;
    /**
     * `true` when an OAuth `authProvider` was supplied and the SDK
     * transport threw `UnauthorizedError` from `client.connect`
     * (no usable token; refresh failed). The `client` and `transport`
     * are still valid but unconnected; the caller must drive the
     * interactive flow via `OAuthFlowOrchestrator` and then retry
     * `client.connect(transport)`.
     *
     * `undefined`/`false` for non-OAuth servers and for OAuth
     * servers whose stored token was still valid (silent connect).
     */
    needsAuth?: boolean;
    transport: unknown;
}

export type SecretResolver = (key: string) => string | null;

/**
 * Optional OAuth-related options forwarded to the MCP SDK transport
 * constructor when a remote server is configured with an `oauth` block.
 *
 * - `authProvider`: an {@link OAuthClientProvider} implementation. When
 *   present, the SDK transport attaches `Authorization` headers from the
 *   provider's tokens and triggers the OAuth flow (refresh, then
 *   authorization redirect) on `UnauthorizedError`.
 * - `fetch`: a custom {@link FetchLike} used for all transport HTTP
 *   requests. Routed through {@link createObsidianFetch} so every outbound
 *   call passes the SSRF guard and Obsidian's `requestUrl` (bypassing
 *   CORS and honoring proxy configuration).
 *
 * Both fields are optional so non-OAuth remote servers reuse the same
 * strategy interface without supplying them.
 */
export interface OAuthConnectOptions {
    readonly authProvider?: OAuthClientProvider;
    readonly fetch?: FetchLike;
}

export interface IMcpTransportStrategy {
    connect(
        server: MCPServerConfig,
        resolveSecret: SecretResolver,
        allowLocalNetworkAccess: boolean,
        oauthOptions?: OAuthConnectOptions,
    ): Promise<McpConnectionResult>;
    terminate(client: Client | null, transport: unknown): Promise<void>;
}