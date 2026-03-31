import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { MCPServerConfig } from "../../settings/types";
import { isExternalUrl } from "../../utils/url";
import { IMcpTransportStrategy, McpConnectionResult, SecretResolver } from "./IMcpTransportStrategy";
import { resolveMcpSecrets } from "./utils";

export class StreamableHttpTransportStrategy implements IMcpTransportStrategy {
    public async connect(
        server: MCPServerConfig, 
        resolveSecret: SecretResolver, 
        allowLocalNetworkAccess: boolean
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
                headers = resolveMcpSecrets(server.remoteHeaders, resolveSecret);
            } catch (e) {
                throw new Error(`Header configuration error: ${e instanceof Error ? e.message : "Unknown error"}`);
            }
        }

        const httpImport = await import('@modelcontextprotocol/sdk/client/streamableHttp.js') as Record<string, unknown>;
        const TransportClass = httpImport['StreamableHTTPClientTransport'] as new (url: URL, options?: { headers?: Record<string, string> }) => import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
        
        const transport = new TransportClass(new URL(urlStr), { headers });
        const client = new Client({
            name: "vault-intelligence",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        await client.connect(transport);

        return { client, transport };
    }

    public async terminate(client: Client | null): Promise<void> {
        if (client) {
            await client.close().catch(() => {});
        }
    }
}
