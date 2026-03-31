import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { MCPServerConfig } from "../../settings/types";

export interface McpConnectionResult {
    client: Client;
    transport: unknown;
}

export type SecretResolver = (key: string) => string | null;

export interface IMcpTransportStrategy {
    connect(server: MCPServerConfig, resolveSecret: SecretResolver, allowLocalNetworkAccess: boolean): Promise<McpConnectionResult>;
    terminate(client: Client | null, transport: unknown): Promise<void>;
}
