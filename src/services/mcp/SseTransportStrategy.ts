import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { MCPServerConfig } from "../../settings/types";
import { resolveSecrets } from "../../utils/secrets";
import { isExternalUrl } from "../../utils/url";
import { IMcpTransportStrategy, McpConnectionResult, OAuthConnectOptions, SecretResolver } from "./IMcpTransportStrategy";

/**
 * Transport strategy for the (deprecated) MCP SSE transport.
 *
 * When an {@link OAuthConnectOptions.authProvider} is supplied (OAuth-gated
 * remote server on desktop), the SDK transport is constructed with
 * `authProvider` and `fetch` so the SDK attaches `Authorization` headers,
 * refreshes expired access tokens, and throws `UnauthorizedError` from
 * `client.connect` when an interactive authorization flow is required.
 *
 * Per the SDK contract (`sse.d.ts:31-36`), `eventSourceInit` is NOT set
 * when `authProvider` is given because doing so suppresses the automatic
 * `Authorization` header attachment on the SSE stream request. The
 * `requestInit.headers` continue to apply to the recurring POST requests.
 */
export class SseTransportStrategy implements IMcpTransportStrategy {
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

        const sseImport = await import('@modelcontextprotocol/sdk/client/sse.js') as Record<string, unknown>;
        const TransportClass = sseImport['SSEClientTransport'] as new (url: URL, options?: SSEClientTransportOptions) => Transport;

        let options: SSEClientTransportOptions;
        if (oauthOptions?.authProvider) {
            // Do NOT set eventSourceInit: it suppresses the automatic
            // Authorization header attachment when authProvider is given
            // (sse.d.ts:31-36). requestInit.headers still apply to POSTs.
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
        // UnauthorizedError when no usable token exists. The transport and
        // client remain valid; the caller drives the interactive flow via
        // OAuthFlowOrchestrator and retries `client.connect`. Non-OAuth
        // errors propagate as regular connection failures.
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