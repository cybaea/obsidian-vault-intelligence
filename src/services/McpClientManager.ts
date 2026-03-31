/* global process -- Native Node.js global available on desktop */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { App, Platform } from "obsidian";

import { MCP_CONSTANTS, SANITIZATION_CONSTANTS, SEARCH_CONSTANTS } from "../constants";
import { MCPServerConfig, VaultIntelligenceSettings } from "../settings/types";
import { IProvider, IToolDefinition, ProviderError } from "../types/providers";
import { JsonValue, truncateJsonStrings } from "../utils/json";
import { logger } from "../utils/logger";
import { isExternalUrl } from "../utils/url";


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
    status: 'connecting' | 'connected' | 'error' | 'untrusted';
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
                // Gracefully close client first (sends JSON-RPC shutdown)
                const client = connection.client;
                if (client) await client.close().catch(() => {});
                
                // For stdio, we explicitly kill the process tree to avoid zombies
                if (connection.config.type === 'stdio' && connection.pid) {
                    if (Platform.isDesktopApp) {
                        try {
                            // eslint-disable-next-line import/no-nodejs-modules -- safe dynamic require guarded by isDesktopApp
                            const cp = await import('child_process');
                            const pid = connection.pid;
                            if (process.platform === 'win32') {
                                const killer = cp.spawn('taskkill', ['/pid', String(pid), '/t', '/f']);
                                killer.on('error', (err: Error) => logger.warn(`taskkill failed for MCP server ${connection.config.name}:`, err));
                            } else {
                                // Attempt to kill child processes (prevents blocking)
                                const killer = cp.spawn('pkill', ['-P', String(pid)]);
                                killer.on('error', () => {
                                    // Fallback: if pkill is missing, attempt to kill the parent cleanly
                                    try { process.kill(pid); } catch { /* ignore */ }
                                });
                                killer.on('close', () => {
                                    try { process.kill(pid); } catch { /* ignore */ }
                                });
                                // Timeout fallback to guarantee parent death if pkill hangs
                                setTimeout(() => { try { process.kill(pid); } catch { /* ignore */ } }, 1000);
                            }
                        } catch (e) {
                            logger.warn(`Failed to kill process tree for MCP server ${connection.config.name}:`, e);
                        }
                    }
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

    public checkTrustState(config: MCPServerConfig): { trusted: boolean; hash: string } {
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

        if (server.type === 'stdio') {
            if (!Platform.isDesktopApp) {
                logger.warn(`Skipping stdio MCP server ${server.name} on Mobile.`);
                return;
            }


            // Use dynamic import so esbuild bundles it, but execution is deferred (mobile safe)
            const mcpSdk = await import('@modelcontextprotocol/sdk/client/stdio.js');
            const StdioClientTransport = mcpSdk.StdioClientTransport;
            
            // Construct minimal safe environment (Fix for Host Environment Leakage)
            const safeKeys = [
                'PATH', 'USER', 'HOME', 'USERPROFILE', 'APPDATA', 'TMPDIR', 'TEMP',
                'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
                'LANG', 'LC_ALL', 'PWD', 'LOGNAME', 'SHELL',
                // Linux Desktop/DBus Requirements
                'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'XDG_SESSION_TYPE'
            ];
            let mergedEnv: Record<string, string> = {
                // Let servers know they are being run by Vault Intelligence
                'OBSIDIAN_VAULT_INTELLIGENCE': 'true'
            };
            
            for (const key of safeKeys) {
                const val = process.env[key];
                if (val !== undefined) {
                    mergedEnv[key] = val;
                }
            }

            // Fix PATH for GUI-launched apps (Obsidian often lacks user bin paths)
            const isWin = process.platform === 'win32';
            const pathSeparator = isWin ? ';' : ':';
            const home = mergedEnv.HOME || mergedEnv.USERPROFILE || '';
            const extraPaths = isWin ? [] : [
                '/usr/local/bin',
                '/opt/homebrew/bin',
                '/opt/local/bin',
                home ? `${home}/.local/bin` : '',
                home ? `${home}/bin` : ''
            ].filter(p => p.length > 0);
            
            if (extraPaths.length > 0) {
                // Prepend extra paths so they take precedence over system bins
                mergedEnv.PATH = `${extraPaths.join(pathSeparator)}${pathSeparator}${mergedEnv.PATH || ''}`;
            }

            if (server.env) {
                try {
                    const customEnv = JSON.parse(server.env) as Record<string, string>;
                    for (const [k, v] of Object.entries(customEnv)) {
                        if (v.startsWith('vi-secret:')) {
                            const secretKey = v.substring(10);
                            const secretVal = this.getSecretValue(secretKey);
                            if (secretVal === null) {
                                throw new Error(`Missing secret for ${k}. Please re-enter it in settings.`);
                            }
                            mergedEnv[k] = secretVal;
                        } else {
                            mergedEnv[k] = v;
                        }
                    }
                } catch (e) {
                    logger.warn(`Failed to process custom environment for MCP server ${server.name}: ${e instanceof Error ? e.message : "Unknown error"}`);
                    this.connections.set(server.id, {
                        client: null as unknown as Client,
                        config: server,
                        errorMessage: `Configuration error: ${e instanceof Error ? e.message : "Unknown error"}`,
                        status: 'error',
                        transport: null
                    });
                    return;
                }
            }

            if (!server.command) {
                logger.warn(`MCP server ${server.name} is missing a command.`);
                this.connections.set(server.id, {
                    client: null as unknown as Client,
                    config: server,
                    errorMessage: `Configuration error: missing command`,
                    status: 'error',
                    transport: null
                });
                return;
            }

            const transportConfig = {
                args: server.args || [],
                command: server.command,
                env: mergedEnv,
                stderr: 'pipe' as 'pipe' | 'ignore' | 'inherit' | 'overlapped'
            };
            const transport = new StdioClientTransport(transportConfig);

            if (transport.stderr) {
                transport.stderr.on('data', (chunk: { toString: () => string }) => {
                    const str = chunk.toString().trim();
                    if (str) {
                        const lower = str.toLowerCase();
                        if (lower.includes('error') || lower.includes('critical') || lower.includes('traceback') || lower.includes('exception')) {
                            logger.error(`[MCP ${server.name} STDERR] ${str}`);
                        } else if (lower.includes('warn')) {
                            logger.warn(`[MCP ${server.name} STDERR] ${str}`);
                        } else if (lower.includes('debug') || lower.includes('trace')) {
                            logger.debug(`[MCP ${server.name} STDERR] ${str}`);
                        } else {
                            // Default to info for diagnostic output that isn't clearly an error
                            logger.info(`[MCP ${server.name} STDERR] ${str}`);
                        }
                    }
                });
            }

            // Note: StdioClientTransport spawns the process internally when start() is called.
            // But we need the PID for killing. It doesn't expose it cleanly, so we might need a workaround.
            // For now, we instantiate the SDK and hope it doesn't leave zombies.

            const client = new Client({
                name: "vault-intelligence",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            try {
                await client.connect(transport);
                this.connections.set(server.id, {
                    client,
                    config: server,
                    pid: (transport as unknown as { _process?: { pid: number } })._process?.pid, // internal SDK access workaround
                    status: 'connected',
                     
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
                    transport: null
                });
            }

        } else if (server.type === 'sse') {
            if (!server.url) return;
            const urlStr = server.url.trim();
            if (!isExternalUrl(urlStr, this.settings.allowLocalNetworkAccess)) {
                logger.warn(`MCP server ${server.name} blocked by Local Network Access security settings.`);
                this.connections.set(server.id, {
                    client: null as unknown as Client,
                    config: server,
                    errorMessage: 'Connection blocked by Local Network Access security settings.',
                    status: 'error',
                    transport: null
                });
                return;
            }

            const sseImport = await import('@modelcontextprotocol/sdk/client/sse.js') as Record<string, unknown>;
            const TransportClass = sseImport['SSEClientTransport'] as new (url: URL, options?: { requestInit?: { headers?: Record<string, string> } }) => import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
            
            let headers: Record<string, string> = {};
            if (server.remoteHeaders) {
                try { 
                    const rawHeaders = JSON.parse(server.remoteHeaders) as Record<string, string>;
                    for (const [k, v] of Object.entries(rawHeaders)) {
                        if (v.startsWith('vi-secret:')) {
                            const secretKey = v.substring(10);
                            const secretVal = this.getSecretValue(secretKey);
                            if (secretVal === null) {
                                throw new Error(`Missing secret for header ${k}. Please re-enter it in settings.`);
                            }
                            headers[k] = secretVal;
                        } else {
                            headers[k] = v;
                        }
                    }
                } catch (e) {
                    logger.warn(`Failed to process remote headers for ${server.name}: ${e instanceof Error ? e.message : "Unknown error"}`);
                    this.connections.set(server.id, {
                        client: null as unknown as Client,
                        config: server,
                        errorMessage: `Header configuration error: ${e instanceof Error ? e.message : "Unknown error"}`,
                        status: 'error',
                        transport: null
                    });
                    return;
                }
            }

            const transport = new TransportClass(new URL(urlStr), { requestInit: { headers } });
            const client = new Client({
                name: "vault-intelligence",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            try {
                await client.connect(transport);
                this.connections.set(server.id, {
                    client,
                    config: server,
                    status: 'connected',
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
                    transport: null
                });
            }
        } else if (server.type === 'streamable_http') {
            if (!server.url) return;
            const urlStr = server.url.trim();
            if (!isExternalUrl(urlStr, this.settings.allowLocalNetworkAccess)) {
                logger.warn(`MCP server ${server.name} blocked by Local Network Access security settings.`);
                this.connections.set(server.id, {
                    client: null as unknown as Client,
                    config: server,
                    errorMessage: 'Connection blocked by Local Network Access security settings.',
                    status: 'error',
                    transport: null
                });
                return;
            }

            let headers: Record<string, string> = {};
            if (server.remoteHeaders) {
                try { 
                    const rawHeaders = JSON.parse(server.remoteHeaders) as Record<string, string>;
                    for (const [k, v] of Object.entries(rawHeaders)) {
                        if (v.startsWith('vi-secret:')) {
                            const secretKey = v.substring(10);
                            const secretVal = this.getSecretValue(secretKey);
                            if (secretVal === null) {
                                throw new Error(`Missing secret for header ${k}. Please re-enter it in settings.`);
                            }
                            headers[k] = secretVal;
                        } else {
                            headers[k] = v;
                        }
                    }
                } catch (e) {
                    logger.warn(`Failed to process MCP headers for ${server.name}: ${e instanceof Error ? e.message : "Unknown error"}`);
                    this.connections.set(server.id, {
                        client: null as unknown as Client,
                        config: server,
                        errorMessage: `Header configuration error: ${e instanceof Error ? e.message : "Unknown error"}`,
                        status: 'error',
                        transport: null
                    });
                    return;
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

            try {
                await client.connect(transport);
                this.connections.set(server.id, {
                    client,
                    config: server,
                    status: 'connected',
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
                    transport: null
                });
            }
        }
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

        try {
            // Include strict timeout
            const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP Tool Execution Timeout")), MCP_CONSTANTS.TOOL_EXECUTION_TIMEOUT_MS));
            
            const abortPromises: Promise<never>[] = [];
            if (signal) {
                if (signal.aborted) return { text: "[Tool execution was cancelled by the user]" };
                abortPromises.push(new Promise<never>((_, reject) => {
                    const onAbort = () => reject(new Error("AbortError"));
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
