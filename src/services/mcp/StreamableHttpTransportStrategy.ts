import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { MCPServerConfig } from "../../settings/types";
import { resolveSecrets } from "../../utils/secrets";
import { isExternalUrl } from "../../utils/url";
import { IMcpTransportStrategy, McpConnectionResult, OAuthConnectOptions, SecretResolver } from "./IMcpTransportStrategy";

/**
 * Transport strategy for the MCP Streamable HTTP transport.
 *
 * When an {@link OAuthConnectOptions.authProvider} is supplied (OAuth-gated
 * remote server on desktop), the SDK transport is constructed with
 * `authProvider` and `fetch` so the SDK attaches `Authorization` headers,
 * refreshes expired access tokens, and throws {@link UnauthorizedError}
 * from `client.connect` when an interactive authorization flow is required.
 * The orchestrator in `McpClientManager.connectOAuthServer` catches that
 * error and drives the browser consent flow.
 *
 * When no `authProvider` is supplied (non-OAuth remote server), the
 * transport is constructed with only `headers`, preserving the pre-OAuth
 * behavior.
 */
export class StreamableHttpTransportStrategy implements IMcpTransportStrategy {
    public async connect(
        server: MCPServerConfig,
        resolveSecret: SecretResolver,
        allowLocalNetworkAccess: boolean,
        oauthOptions?: OAuthConnectOptions,
    ): Promise<McpConnectionResult> {
        if (!server.url) {
            throw new Error(`Configuration error: missing URL`);
        }

        const urlStr = server.url.trim();
        if (!isExternalUrl(urlStr, allowLocalNetworkAccess)) {
            throw new Error(`Connection blocked by Local Network Access security settings.`);
        }

        let headers: Record<string, string> = {};
        if (server.remoteHeaders) {
            try {
                headers = await resolveSecrets(server.remoteHeaders, resolveSecret, `mcp-${server.id}-headers-`);
            } catch (e) {
                throw new Error(`Header configuration error: ${e instanceof Error ? e.message : "Unknown error"}`);
            }
        }

        const httpImport = await import('@modelcontextprotocol/sdk/client/streamableHttp.js') as Record<string, unknown>;
        const TransportClass = httpImport['StreamableHTTPClientTransport'] as new (url: URL, options?: StreamableHTTPClientTransportOptions) => Transport;

        // Build the SDK transport options. When an authProvider is present
        // (OAuth-gated server), forward it along with the custom fetch
        // (ObsidianFetchAdapter) so the SDK's auth lifecycle uses
        // requestUrl (CORS/proxy-safe) and the SSRF guard. Otherwise
        // construct with only headers to preserve the pre-OAuth behavior.
        let options: StreamableHTTPClientTransportOptions;
        if (oauthOptions?.authProvider) {
            options = {
                authProvider: oauthOptions.authProvider,
                fetch: oauthOptions.fetch,
                requestInit: { headers },
            };
        } else {
            options = { requestInit: { headers } };
        }

        const transport = new TransportClass(new URL(urlStr), options);
        const client = new Client({
            name: "vault-intelligence",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        // When an authProvider is configured, `client.connect` may throw
        // UnauthorizedError when no usable token exists. The transport
        // and client are still valid; the caller drives the interactive
        // flow via OAuthFlowOrchestrator and retries `client.connect`.
        // Catch here so the references are not lost to the caller.
        // Non-OAuth errors propagate as regular connection failures.
        if (oauthOptions?.authProvider) {
            try {
                await client.connect(transport);
            } catch (error) {
                if (error instanceof UnauthorizedError) {
                    return { client, needsAuth: true, transport };
                }
                throw error;
            }
        } else {
            await client.connect(transport);
        }

        return { client, transport };
    }

    public async terminate(client: Client | null): Promise<void> {
        if (client) {
            await client.close().catch(() => {});
        }
    }
}