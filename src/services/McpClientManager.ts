import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { App, Platform } from "obsidian";

import { MCP_CONSTANTS, SANITIZATION_CONSTANTS, SEARCH_CONSTANTS } from "../constants";
import { MCPServerConfig, VaultIntelligenceSettings } from "../settings/types";
import { IProvider, IToolDefinition, ProviderError } from "../types/providers";
import { JsonValue, truncateJsonStrings } from "../utils/json";
import { logger } from "../utils/logger";
import { IMcpTransportStrategy, OAuthConnectOptions } from "./mcp/IMcpTransportStrategy";
import { createDesktopOAuthReceiver } from "./mcp/oauth/DesktopOAuthReceiver";
import { OAuthFlowOrchestrator } from "./mcp/oauth/OAuthFlowOrchestrator";
import { DefaultOAuthTokenStore } from "./mcp/oauth/OAuthTokenStore";
import { createObsidianFetch } from "./mcp/oauth/ObsidianFetchAdapter";
import { ObsidianOAuthClientProvider } from "./mcp/oauth/ObsidianOAuthClientProvider";
import { SseTransportStrategy } from "./mcp/SseTransportStrategy";
import { StdioTransportStrategy } from "./mcp/StdioTransportStrategy";
import { StreamableHttpTransportStrategy } from "./mcp/StreamableHttpTransportStrategy";


interface InternalSecretStorage {
    clearSecret?(key: string): void;
    getSecret(key: string): string | null;
    setSecret?(key: string, value: string): void;
}

interface McpConnection {
    client: Client;
    config: MCPServerConfig;
    errorMessage?: string;
    pid?: number;
    status: 'auth-pending' | 'connected' | 'connecting' | 'disconnected' | 'error' | 'untrusted';
    strategy?: IMcpTransportStrategy;
    transport: unknown; // StdioClientTransport or SSEClientTransport
}

export class McpClientManager implements IProvider {
    private app: App;
    private settings: VaultIntelligenceSettings;
    private connections = new Map<string, McpConnection>();
    private toolNameMap = new Map<string, { originalName: string; serverId: string }>();

    constructor(app: App, settings: VaultIntelligenceSettings) {
        this.app = app;
        this.settings = settings;
    }

    public initialize(): Promise<void> {
        // Non-blocking initialization
        Promise.resolve().then(async () => {
            for (const server of this.settings.mcpServers || []) {
                if (server.enabled) {
                    await this.connectServer(server).catch(e => {
                        logger.error(`Failed to connect to MCP server ${server.name}`, e);
                    });
                }
            }
        }).catch(e => { logger.error("MCP initialization failed", e); });
        return Promise.resolve();
    }

    public async terminate(): Promise<void> {
        for (const [, connection] of this.connections.entries()) {
            try {
                if (connection.strategy) {
                    await connection.strategy.terminate(connection.client, connection.transport);
                } else if (connection.client) {
                    await connection.client.close().catch(() => {});
                }
            } catch (e) {
                logger.error(`Error terminating MCP server ${connection.config.name}:`, e);
            }
        }
        this.connections.clear();
        this.toolNameMap.clear();
    }

    public async updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        
        // Terminate all current connections to ensure clean state
        await this.terminate();
        
        // Re-initialize based on the newly saved settings
        void this.initialize();
    }

    private async generateTrustHash(config: MCPServerConfig): Promise<string> {
        const payload = JSON.stringify({
            args: config.args,
            command: config.command,
            env: config.env,
            oauth: config.oauth ? {
                clientId: config.oauth.clientId,
                // Represent the secret as a presence flag, never the
                // value itself. The secret lives in SecretStorage, not
                // in the sync-persisted config. A `vi-secret:` placeholder
                // string is truthy; an absent secret is undefined/false.
                hasClientSecret: Boolean(config.oauth.clientSecret),
                // Sort scopes so a user reordering them (or a sync with
                // a different array order) does not produce a false
                // positive trust-hash mismatch.
                scopes: [...config.oauth.scopes].sort(),
            } : undefined,
            remoteHeaders: config.remoteHeaders,
            requireExplicitConfirmation: config.requireExplicitConfirmation,
            url: config.url
        });
        const encoder = new TextEncoder();
        const data = encoder.encode(payload);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    public checkTrustState(_config: MCPServerConfig): { trusted: boolean; hash: string } {
        // Obsolete synchronous check, actual check moved to connectServer.
        // Returning untrusted to be safe if a legacy caller uses it.
        return { hash: '', trusted: false };
    }

    private getSecretValue(key: string): string | null {
        try {
            const storage = this.app.secretStorage as unknown as InternalSecretStorage | undefined;
            if (storage && storage.getSecret) {
                return storage.getSecret(key);
            }
        } catch (e) {
            logger.error(`Failed to read secret ${key}`, e);
        }
        return null;
    }

    private async connectServer(server: MCPServerConfig): Promise<void> {
        logger.info(`Connecting to MCP server ${server.name}...`);
        
        // Trust Hash Security (Applied to ALL server types to prevent remote manipulation via sync)
        const currentHash = await this.generateTrustHash(server);
        const storedHash = window.localStorage.getItem(`vi-mcp-trust-${server.id}`);
        if (currentHash !== storedHash) {
            logger.warn(`MCP server ${server.name} untrusted. Blocking execution.`);
            this.connections.set(server.id, {
                client: null as unknown as Client,
                config: server,
                errorMessage: 'Untrusted configuration. Please approve in settings.',
                status: 'untrusted',
                transport: null
            });
            return;
        }

        const secretResolver = (key: string) => this.getSecretValue(key);
        let strategy: IMcpTransportStrategy;

        // OAuth-gated remote servers are desktop-only (the loopback
        // receiver requires Node's http module, unavailable on mobile).
        // The oauth config field is parsed on mobile for sync
        // compatibility, but never activated. Mirrors the untrusted
        // parking pattern: set an error status and return before
        // strategy selection so non-OAuth remote servers still work
        // on mobile.
        if (server.oauth && !Platform.isDesktopApp) {
            logger.info(`MCP server ${server.name} requires OAuth, which is desktop-only. Skipping on mobile.`);
            this.connections.set(server.id, {
                client: null as unknown as Client,
                config: server,
                errorMessage: 'OAuth-gated remote servers are only supported on desktop.',
                status: 'error',
                transport: null
            });
            return;
        }

        if (server.type === 'stdio') {
            strategy = new StdioTransportStrategy();
        } else if (server.type === 'sse') {
            strategy = new SseTransportStrategy();
        } else if (server.type === 'streamable_http') {
            strategy = new StreamableHttpTransportStrategy();
        } else {
            logger.warn(`MCP server ${server.name} has unknown type ${String(server.type)}.`);
            return;
        }

        try {
            // For OAuth-gated remote servers, build the OAuth provider
            // and fetch adapter so the transport strategy forwards
            // them to the SDK transport constructor. The SDK then
            // attaches Authorization headers and reports `needsAuth`
            // (via UnauthorizedError caught inside the strategy) when
            // an interactive flow is required.
            const oauthOptions = server.oauth
                ? this.buildOAuthConnectOptions(server)
                : undefined;

            const { client, needsAuth, transport } = await strategy.connect(
                server,
                secretResolver,
                this.settings.allowLocalNetworkAccess,
                oauthOptions,
            );

            if (needsAuth && server.oauth && oauthOptions) {
                // SDK transport reported no usable token. Hand control
                // to the interactive flow (loopback receiver + browser
                // consent + token exchange + connect retry). The client
                // and transport built here are reused by the orchestrator.
                logger.info(`MCP server ${server.name} requires OAuth authorization. Starting interactive flow.`);
                await this.runOAuthFlow(server, strategy, client, transport, oauthOptions);
                return;
            }

            this.connections.set(server.id, {
                client,
                config: server,
                status: 'connected',
                strategy,
                transport
            });
            logger.info(`MCP Server ${server.name} connected.`);
        } catch (error) {
            logger.error(`MCP Server ${server.name} connection failed.`, error);
            this.connections.set(server.id, {
                client: null as unknown as Client,
                config: server,
                errorMessage: String(error),
                status: 'error',
                strategy,
                transport: null
            });
        }
    }

    /**
     * Builds the {@link OAuthConnectOptions} (provider + fetch adapter)
     * passed to the transport strategy for an OAuth-gated remote server.
     *
     * The provider is constructed eagerly so the SDK transport can read
     * any stored tokens on the initial connect attempt (enabling silent
     * token reuse and refresh without opening a browser). The fetch
     * adapter routes all SDK HTTP through Obsidian's `requestUrl` and
     * the SSRF guard.
     */
    private buildOAuthConnectOptions(server: MCPServerConfig): OAuthConnectOptions {
        const store = new DefaultOAuthTokenStore(this.app.secretStorage);
        const provider = new ObsidianOAuthClientProvider(server.id, store);
        const fetchFn = createObsidianFetch({
            allowLocalNetworkAccess: this.settings.allowLocalNetworkAccess,
        });
        return { authProvider: provider, fetch: fetchFn };
    }

    /**
     * Drives the interactive OAuth flow after a transport strategy
     * reported `needsAuth` (UnauthorizedError from the SDK transport's
     * initial connect attempt).
     *
     * Reuses the provider/fetch built for the initial attempt so the
     * loopback receiver, the SDK `auth()` helper, and the transport's
     * `finishAuth` share a single token store and redirect URL. On
     * success, the connection is marked `'connected'`; on failure,
     * `'error'` with a user-presentable message.
     */
    private async runOAuthFlow(
        server: MCPServerConfig,
        strategy: IMcpTransportStrategy,
        client: Client,
        transport: unknown,
        oauthOptions: OAuthConnectOptions,
    ): Promise<void> {
        const provider = oauthOptions.authProvider as ObsidianOAuthClientProvider | undefined;
        const fetchFn = oauthOptions.fetch;
        if (!provider || !fetchFn || !server.url) {
            this.connections.set(server.id, {
                client: null as unknown as Client,
                config: server,
                errorMessage: 'OAuth configuration is incomplete.',
                status: 'error',
                strategy,
                transport: null,
            });
            return;
        }

        // Park the connection as auth-pending so the UI can show the
        // user that a browser consent flow is in progress.
        this.connections.set(server.id, {
            client: null as unknown as Client,
            config: server,
            status: 'auth-pending',
            strategy,
            transport: null,
        });

        try {
            const receiver = createDesktopOAuthReceiver();
            const orchestrator = new OAuthFlowOrchestrator(
                provider,
                receiver,
                transport as { finishAuth(code: string): Promise<void> },
                client,
                transport,
                server.url,
                fetchFn,
            );
            const result = await orchestrator.authorize();
            if (result.status === 'authorized') {
                this.connections.set(server.id, {
                    client,
                    config: server,
                    status: 'connected',
                    strategy,
                    transport,
                });
                logger.info(`MCP Server ${server.name} connected via OAuth.`);
            } else {
                this.connections.set(server.id, {
                    client: null as unknown as Client,
                    config: server,
                    errorMessage: result.errorMessage ?? 'OAuth authorization failed.',
                    status: 'error',
                    strategy,
                    transport: null,
                });
            }
        } catch (error) {
            logger.error(`MCP Server ${server.name} OAuth flow failed.`, error);
            this.connections.set(server.id, {
                client: null as unknown as Client,
                config: server,
                errorMessage: String(error),
                status: 'error',
                strategy,
                transport: null,
            });
        }
    }

    /**
     * Public entry point for the settings UI "Connect/Reconnect" button
     * for an OAuth-gated remote server.
     *
     * Re-runs {@link connectServer}, which performs the trust check,
     * the mobile guard, the initial connect attempt, and (on
     * UnauthorizedError) the interactive flow via {@link runOAuthFlow}.
     */
    public async connectOAuthServer(serverId: string): Promise<void> {
        const server = (this.settings.mcpServers || []).find(s => s.id === serverId);
        if (!server || !server.oauth || !Platform.isDesktopApp) {
            return;
        }
        await this.connectServer(server);
    }

    /**
     * Public entry point for the settings UI "Disconnect" button for an
     * OAuth-gated remote server.
     *
     * Invalidates the persisted OAuth credentials (tokens, verifier,
     * client info, discovery state) so a subsequent connect requires a
     * fresh browser consent. Closes the SDK client and marks the
     * connection `'disconnected'`.
     */
    public async disconnectOAuthServer(serverId: string): Promise<void> {
        const connection = this.connections.get(serverId);
        const server = (this.settings.mcpServers || []).find(s => s.id === serverId);
        if (!connection || !server?.oauth) {
            return;
        }

        const store = new DefaultOAuthTokenStore(this.app.secretStorage);
        const provider = new ObsidianOAuthClientProvider(serverId, store);
        await provider.invalidateCredentials('all');

        if (connection.strategy) {
            await connection.strategy.terminate(connection.client, connection.transport).catch(() => {});
        } else if (connection.client) {
            await connection.client.close().catch(() => {});
        }

        this.connections.delete(serverId);
    }

    private sanitizeMcpSchema(schema: unknown): unknown {
        if (!schema || typeof schema !== 'object') return schema;
        if (Array.isArray(schema)) {
            return schema.map(item => this.sanitizeMcpSchema(item));
        }

        const allowedKeys = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable']);
        const sanitized: Record<string, unknown> = {};
        const schemaRecord = schema as Record<string, unknown>;

        for (const [key, value] of Object.entries(schemaRecord)) {
            // "properties" is a special map where keys are parameter names, not schema keywords.
            // We must traverse its values individually.
            if (key === 'properties' && value && typeof value === 'object') {
                const propsMap: Record<string, unknown> = {};
                for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
                    propsMap[propName] = this.sanitizeMcpSchema(propSchema);
                }
                sanitized['properties'] = propsMap;
            } else if (allowedKeys.has(key)) {
                sanitized[key] = this.sanitizeMcpSchema(value);
            }
        }

        // If a property relied entirely on a $ref or $defs, we must assign it a fallback type 
        // because Gemini requires 'type' to be explicitly defined for schema nodes.
        if (!sanitized['type'] && !sanitized['properties'] && !sanitized['items']) {
            if (!sanitized['description']) {
                sanitized['description'] = 'Complex object fallback';
            }
            sanitized['type'] = 'string';
        }

        return sanitized;
    }

    public async getAvailableTools(): Promise<IToolDefinition[]> {
        const tools: IToolDefinition[] = [];
        this.toolNameMap.clear();

        for (const [serverId, connection] of this.connections.entries()) {
            if (connection.status !== 'connected' || !connection.client) continue;

            try {
                const response = await connection.client.listTools();
                for (const tool of response.tools) {
                    // Tool Name Sanitization & Collisions
                    const safeServerId = serverId.replace(/[^a-zA-Z0-9_-]/g, '');
                    const safeToolName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '');
                    let compositeName = `mcp__${safeServerId}__${safeToolName}`;

                    if (compositeName.length > 64) {
                        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tool.name));
                        const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                        const shortHash = hashHex.substring(0, 8);
                        compositeName = compositeName.substring(0, 64 - 8) + shortHash;
                    }

                    this.toolNameMap.set(compositeName, { originalName: tool.name, serverId });

                    const rawSchema = tool.inputSchema || { properties: {}, type: "object" };
                    const sanitizedSchema = this.sanitizeMcpSchema(rawSchema);

                    tools.push({
                        description: `[MCP: ${connection.config.name}] ${tool.description || ''}`,
                        name: compositeName,
                        parameters: sanitizedSchema as { type: "object"; properties: Record<string, unknown> }
                    });
                }
            } catch (error) {
                logger.error(`Failed to list tools for MCP server ${connection.config.name}`, error);
            }
        }

        return tools;
    }

    public getOriginalToolName(namespaceName: string): string | undefined {
        return this.toolNameMap.get(namespaceName)?.originalName;
    }

    public async executeTool(namespaceName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string }> {
        const mapping = this.toolNameMap.get(namespaceName);
        if (!mapping) throw new ProviderError(`Unrecognized MCP tool namespace or server disconnected: ${namespaceName}`, "mcp");

        const connection = this.connections.get(mapping.serverId);
        if (!connection || connection.status !== 'connected') {
            throw new ProviderError(`MCP server ${mapping.serverId} is not connected.`, "mcp");
        }

        if (connection.config.type === 'sse') {
            // Mobile SSE Resiliency: Simple check to see if we're connected
            try {
                // Ideally sending a ping, but SDK lacks ping. We catch execution errors fast.
            } catch {
                logger.warn("SSE stream might be closed, should retry.");
            }
        }

        let timeoutId: number | undefined;
        let onAbort: (() => void) | undefined;

        try {
            // Include strict timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = window.setTimeout(() => reject(new Error("MCP Tool Execution Timeout")), MCP_CONSTANTS.TOOL_EXECUTION_TIMEOUT_MS);
            });
            
            const abortPromises: Promise<never>[] = [];
            if (signal) {
                if (signal.aborted) return { text: "[Tool execution was cancelled by the user]" };
                abortPromises.push(new Promise<never>((_, reject) => {
                    onAbort = () => reject(new Error("AbortError"));
                    signal.addEventListener('abort', onAbort, { once: true });
                }));
            }

            const execPromise = connection.client.callTool({
                arguments: args,
                name: mapping.originalName
            });

            const result = await Promise.race([execPromise, timeoutPromise, ...abortPromises]) as CallToolResult;
            
            let outputText = "";
            if (result.content && result.content.length > 0) {
                outputText = result.content.map(c => {
                    if (c.type === 'text') {
                        try {
                            const parsed = JSON.parse(c.text) as unknown;
                            if (parsed && typeof parsed === 'object') {
                                const truncated = truncateJsonStrings(parsed as JsonValue, SANITIZATION_CONSTANTS.MAX_LOG_STRING_LENGTH);
                                return JSON.stringify(truncated);
                            }
                        } catch {
                            // Valid logic fallback for non-JSON text
                        }
                        return c.text;
                    }
                    return `[${c.type} content]`;
                }).join('\n');
            }

            if (result.isError) {
                return { text: `[Error from MCP Tool] \n${outputText}` };
            }

            // Payload Context Safety Fallback
            if (outputText.length > SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) {
                outputText = outputText.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) + "\n...[TRUNCATED BY VAULT INTELLIGENCE]...";
            }

            return { text: outputText || "[Tool executed successfully with no output]" };

        } catch (error) {
            if (error instanceof Error && error.message === "AbortError") {
                return { text: "[Tool execution was cancelled by the user]" };
            }
            throw new ProviderError(`Failed to execute MCP tool ${mapping.originalName}: ${String(error)}`, "mcp");
        } finally {
            if (timeoutId) window.clearTimeout(timeoutId);
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        }
    }

    public async getAvailableResources(): Promise<Record<string, unknown>[]> {
        const resources: Record<string, unknown>[] = [];
        for (const [serverId, connection] of this.connections.entries()) {
            if (connection.status !== 'connected' || !connection.client) continue;
            try {
                const response = await connection.client.listResources();
                for (const res of response.resources || []) {
                    resources.push({
                        ...res,
                        id: `mcp__${serverId}__${res.uri}`,
                        serverId
                    });
                }
            } catch (error) {
                logger.error(`Failed to list resources for MCP server ${connection.config.name}`, error);
            }
        }
        return resources;
    }

    public async readResource(serverId: string, uri: string): Promise<Record<string, unknown>> {
        const connection = this.connections.get(serverId);
        if (!connection || connection.status !== 'connected') {
            throw new ProviderError(`MCP server ${serverId} is not connected.`, "mcp");
        }
        try {
            return await connection.client.readResource({ uri });
        } catch (error) {
            throw new ProviderError(`Failed to read MCP resource ${uri}: ${String(error)}`, "mcp");
        }
    }

    public async getAvailablePrompts(): Promise<Record<string, unknown>[]> {
        const prompts: Record<string, unknown>[] = [];
        for (const [serverId, connection] of this.connections.entries()) {
            if (connection.status !== 'connected' || !connection.client) continue;
            try {
                const response = await connection.client.listPrompts();
                for (const prompt of response.prompts || []) {
                    prompts.push({
                        ...prompt,
                        id: `mcp__${serverId}__${prompt.name}`,
                        serverId
                    });
                }
            } catch (error) {
                logger.error(`Failed to list prompts for MCP server ${connection.config.name}`, error);
            }
        }
        return prompts;
    }
}
