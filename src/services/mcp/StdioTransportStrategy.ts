/* global process -- Native Node.js global available on desktop */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Platform } from "obsidian";

import { MCPServerConfig } from "../../settings/types";
import { logger } from "../../utils/logger";
import { IMcpTransportStrategy, McpConnectionResult, SecretResolver } from "./IMcpTransportStrategy";
import { resolveMcpSecrets } from "./utils";

// Native implementation to bypass esbuild/CJS/ESM corruption of cross-spawn
// See also: https://github.com/cybaea/obsidian-vault-intelligence/issues/389
class NativeStdioTransport {
    private process: any = null;
    private buffer: string = "";
    
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: any) => void;

    constructor(private command: string, private args: string[], private env: Record<string, string>, private serverName: string) {}

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const cp = require("child_process");
                
                this.process = cp.spawn(this.command, this.args, {
                    env: this.env,
                    stdio: ["pipe", "pipe", "pipe"],
                    windowsHide: true
                });

                let resolved = false;

                this.process.on("error", (error: Error) => {
                    if (!resolved) {
                        reject(error);
                    } else if (this.onerror) {
                        this.onerror(error);
                    }
                });

                if (this.process.pid) {
                    resolved = true;
                    resolve();
                }

                this.process.stdout.setEncoding('utf-8');
                this.process.stdout.on("data", (chunk: string) => {
                    this.buffer += chunk;
                    let newlineIndex;
                    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
                        const line = this.buffer.slice(0, newlineIndex);
                        this.buffer = this.buffer.slice(newlineIndex + 1);
                        const trimmed = line.trim();
                        if (trimmed) {
                            try {
                                const message = JSON.parse(trimmed);
                                if (this.onmessage) this.onmessage(message);
                            } catch (e) {
                                if (this.onerror) this.onerror(new Error("Failed to parse MCP message: " + trimmed));
                            }
                        }
                    }
                });

                this.process.stderr.setEncoding('utf-8');
                this.process.stderr.on("data", (chunk: string) => {
                    const str = chunk.trim();
                    if (str) {
                        const lower = str.toLowerCase();
                        if (lower.includes('error') || lower.includes('critical') || lower.includes('traceback') || lower.includes('exception')) {
                            logger.error(`[MCP ${this.serverName} STDERR] ${str}`);
                        } else if (lower.includes('warn')) {
                            logger.warn(`[MCP ${this.serverName} STDERR] ${str}`);
                        } else if (lower.includes('debug') || lower.includes('trace')) {
                            logger.debug(`[MCP ${this.serverName} STDERR] ${str}`);
                        } else {
                            logger.info(`[MCP ${this.serverName} STDERR] ${str}`);
                        }
                    }
                });

                this.process.on("close", () => {
                    if (this.onclose) this.onclose();
                });

            } catch (e) {
                reject(e);
            }
        });
    }

    async close(): Promise<void> {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        if (this.onclose) this.onclose();
    }

    async send(message: any): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                return reject(new Error("MCP Process not running"));
            }
            const json = JSON.stringify(message);
            this.process.stdin.write(json + "\n", (err: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    get pid() {
        return this.process ? this.process.pid : null;
    }
}

export class StdioTransportStrategy implements IMcpTransportStrategy {
    public async connect(server: MCPServerConfig, resolveSecret: SecretResolver): Promise<McpConnectionResult> {
        if (!Platform.isDesktopApp) {
            throw new Error(`Skipping stdio MCP server ${server.name} on Mobile.`);
        }

        const safeKeys = [
            'PATH', 'USER', 'HOME', 'USERPROFILE', 'APPDATA', 'TMPDIR', 'TEMP',
            'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
            'LANG', 'LC_ALL', 'PWD', 'LOGNAME', 'SHELL',
            'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'XDG_SESSION_TYPE'
        ];
        const mergedEnv: Record<string, string> = {
            'OBSIDIAN_VAULT_INTELLIGENCE': 'true'
        };

        const processEnv = process.env as Record<string, string | undefined>;

        for (const key of safeKeys) {
            const val = processEnv[key];
            if (val !== undefined) {
                mergedEnv[key] = val;
            }
        }

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
            mergedEnv.PATH = `${extraPaths.join(pathSeparator)}${pathSeparator}${mergedEnv.PATH || ''}`;
        }

        if (server.env) {
            try {
                const customEnv = resolveMcpSecrets(server.env, resolveSecret);
                for (const [k, v] of Object.entries(customEnv)) {
                    mergedEnv[k] = v;
                }
            } catch (e) {
                throw new Error(`Configuration error: ${e instanceof Error ? e.message : "Unknown error"}`);
            }
        }

        if (!server.command) {
            throw new Error(`Configuration error: missing command`);
        }

        // Initialize our Native wrapper rather than the bundled SDK
        const transport = new NativeStdioTransport(server.command, server.args || [], mergedEnv, server.name);

        const client = new Client({
            name: "vault-intelligence",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        // The SDK's Client.connect accepts any standard implementation matching the Transport interface
        await client.connect(transport as any);

        return { client, transport };
    }

    public async terminate(client: Client | null, transport: unknown): Promise<void> {
        if (client) {
            await client.close().catch(() => {});
        }

        if (transport && Platform.isDesktopApp) {
            const typedTransport = transport as { pid?: number | null };
            const pid = typedTransport.pid;

            if (pid) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const cp = require('child_process');
                    
                    const processLib = process as unknown as { kill: (pid: number) => void; platform: string; };
                    
                    if (processLib.platform === 'win32') {
                        const killer = cp.spawn('taskkill', ['/pid', String(pid), '/t', '/f']);
                        killer.on('error', (err: Error) => logger.warn(`taskkill failed for MCP server ${pid}:`, err));
                    } else {
                        const killer = cp.spawn('pkill', ['-P', String(pid)]);
                        killer.on('error', () => {
                            try { processLib.kill(pid); } catch { /* ignore */ }
                        });
                        killer.on('close', () => {
                            try { processLib.kill(pid); } catch { /* ignore */ }
                        });
                        setTimeout(() => { try { processLib.kill(pid); } catch { /* ignore */ } }, 1000);
                    }
                } catch (e) {
                    logger.warn(`Failed to kill process tree for MCP pid ${pid}:`, e);
                }
            }
        }
    }
}
