import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { App, Platform } from "obsidian";

import { SEARCH_CONSTANTS } from "../constants";
import { MCPServerConfig, VaultIntelligenceSettings } from "../settings/types";
import { IProvider, IToolDefinition, ProviderError } from "../types/providers";
import { logger } from "../utils/logger";

interface IGlobalRequire {
    process: { env: Record<string, string>; kill(pid: number): void; platform: string };
    require(id: string): unknown;
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
                            const g = globalThis as unknown as IGlobalRequire;
                            const cp = g.require('child_process') as { execSync(cmd: string, opts: { stdio: 'ignore' }): void };
                            if (g.process.platform === 'win32') {
                                cp.execSync(`taskkill /pid ${connection.pid} /t /f`, { stdio: 'ignore' });
                            } else {
                                g.process.kill(connection.pid); // Send standard SIGTERM to parent
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

    public updateSettings(settings: VaultIntelligenceSettings) {
        this.settings = settings;
        // In a full implementation, we would compare the list and only restart changed servers.
        // For Phase 4 MVP, we assume terminate() is called on unload.
    }

    private async generateTrustHash(config: MCPServerConfig): Promise<string> {
        const payload = JSON.stringify({
            args: config.args,
            command: config.command,
            env: config.env
        });
        const encoder = new TextEncoder();
        const data = encoder.encode(payload);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    public checkTrustState(config: MCPServerConfig): { trusted: boolean; hash: string } {
        // Assume everything else trusted except stdio (which runs local processes)
        if (config.type !== 'stdio') return { hash: '', trusted: true };
        return { hash: '', trusted: false }; // Will map implementation later in connectServer
    }

    private async connectServer(server: MCPServerConfig): Promise<void> {
        logger.info(`Connecting to MCP server ${server.name}...`);
        
        if (server.type === 'stdio') {
            if (!Platform.isDesktopApp) {
                logger.warn(`Skipping stdio MCP server ${server.name} on Mobile.`);
                return;
            }

            // Trust Hash Security
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

            const g = globalThis as unknown as IGlobalRequire;
            // Use dynamic import so esbuild bundles it, but execution is deferred (mobile safe)
            const mcpSdk = await import('@modelcontextprotocol/sdk/client/stdio.js');
            const StdioClientTransport = mcpSdk.StdioClientTransport;
            
            // Merge Environments
            let mergedEnv: Record<string, string> = { ...g.process.env };

            // Sanitize Electron/AppImage environment pollution that frequently breaks external Python/Node runtimes
            const keysToRemove = ['PYTHONPATH', 'PYTHONHOME', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'APPDIR', 'APPIMAGE'];
            for (const key of keysToRemove) {
                delete mergedEnv[key];
            }

            if (server.env) {
                try {
                    const customEnv = JSON.parse(server.env) as Record<string, string>;
                    mergedEnv = { ...mergedEnv, ...customEnv };
                } catch {
                    logger.warn(`Failed to parse custom environment for MCP server ${server.name}`);
                }
            }

            let command = server.command!;
            let args = server.args || [];

            // Some executable scripts (like Python scripts generated by `uv`) rely on shell environment execution 
            // to correctly source their relative virtual environments. Since we broke the shell inheritance,
            // we wrap the command explicitly in a shell invocation if not on Windows.
            if (!Platform.isWin) {
                const fullCmd = [command, ...args].map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
                command = "sh";
                args = ["-c", fullCmd];
            }

            const transportConfig = {
                args,
                command,
                env: mergedEnv,
                stderr: 'pipe' as 'pipe' | 'ignore' | 'inherit' | 'overlapped'
            };
            const transport = new StdioClientTransport(transportConfig);

            if (transport.stderr) {
                transport.stderr.on('data', (chunk: { toString: () => string }) => {
                    const str = chunk.toString().trim();
                    if (str) {
                        logger.error(`[MCP ${server.name} STDERR] ${str}`);
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
            const sseImport = await import('@modelcontextprotocol/sdk/client/sse.js') as Record<string, unknown>;
            const TransportClass = sseImport['SSEClientTransport'] as new (url: URL) => import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
            const transport = new TransportClass(new URL(server.url));
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

                    tools.push({
                        description: `[MCP: ${connection.config.name}] ${tool.description || ''}`,
                        name: compositeName,
                        parameters: (tool.inputSchema as unknown as { type: "object"; properties: Record<string, unknown> }) || { properties: {}, type: "object" }
                    });
                }
            } catch (error) {
                logger.error(`Failed to list tools for MCP server ${connection.config.name}`, error);
            }
        }

        return tools;
    }

    public async executeTool(namespaceName: string, args: Record<string, unknown>): Promise<{ text: string }> {
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
            const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP Tool Execution Timeout")), 60000));
            const execPromise = connection.client.callTool({
                arguments: args,
                name: mapping.originalName
            });

            const result = await Promise.race([execPromise, timeoutPromise]) as CallToolResult;
            
            let outputText = "";
            if (result.content && result.content.length > 0) {
                outputText = result.content.map(c => {
                    if (c.type === 'text') return c.text;
                    return `[${c.type} content]`;
                }).join('\n');
            }

            if (result.isError) {
                return { text: `[Error from MCP Tool] \n${outputText}` };
            }

            // Payload Truncation
            if (outputText.length > SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) {
                outputText = outputText.substring(0, SEARCH_CONSTANTS.TOOL_RESPONSE_TRUNCATE_LIMIT) + "\n...[TRUNCATED BY VAULT INTELLIGENCE]...";
            }

            return { text: outputText || "[Tool executed successfully with no output]" };

        } catch (error) {
            throw new ProviderError(`Failed to execute MCP tool ${mapping.originalName}: ${String(error)}`, "mcp");
        }
    }
}
