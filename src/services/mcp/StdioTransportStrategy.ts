/* global process -- Native Node.js global available on desktop */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Platform } from "obsidian";

import { MCPServerConfig } from "../../settings/types";
import { logger } from "../../utils/logger";
import { IMcpTransportStrategy, McpConnectionResult, SecretResolver } from "./IMcpTransportStrategy";
import { resolveMcpSecrets } from "./utils";

interface ChildProcessMinimal {
    kill: () => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    pid?: number;
    stderr: { on: (event: string, listener: (data: string) => void) => void; setEncoding: (enc: string) => void };
    stdin: { write: (data: string, cb: (err?: Error) => void) => void };
    stdout: { on: (event: string, listener: (data: string) => void) => void; setEncoding: (enc: string) => void };
}

interface ChildProcessModule {
    spawn: (command: string, args: string[], options?: unknown) => ChildProcessMinimal;
}

// Native implementation to bypass esbuild/CJS/ESM corruption of cross-spawn
// See also: https://github.com/cybaea/obsidian-vault-intelligence/issues/389
class NativeStdioTransport implements Transport {
    private buffer: string = "";
    private childProcess: ChildProcessMinimal | null = null;
    
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(private command: string, private args: string[], private env: Record<string, string>, private serverName: string) {}

    async close(): Promise<void> {
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
        }
        if (this.onclose) this.onclose();
        return Promise.resolve();
    }

    get pid(): number | null {
        return this.childProcess ? (this.childProcess.pid ?? null) : null;
    }

    async send(message: JSONRPCMessage): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.childProcess || !this.childProcess.stdin) {
                return reject(new Error("MCP Process not running"));
            }
            const json = JSON.stringify(message);
            this.childProcess.stdin.write(json + "\n", (err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async start(): Promise<void> {
        // eslint-disable-next-line import/no-nodejs-modules -- Desktop-only child_process operations
        const cpModule = await import("child_process") as unknown as ChildProcessModule;
        return new Promise<void>((resolve, reject) => {
            try {
                this.childProcess = cpModule.spawn(this.command, this.args, {
                        env: this.env,
                        stdio: ["pipe", "pipe", "pipe"],
                        windowsHide: true
                    });

                    let resolved = false;

                    this.childProcess.on("error", (error: unknown) => {
                        const err = error instanceof Error ? error : new Error(String(error));
                        if (!resolved) {
                            reject(err);
                        } else if (this.onerror) {
                            this.onerror(err);
                        }
                    });

                    if (this.childProcess.pid) {
                        resolved = true;
                        resolve();
                    }

                    this.childProcess.stdout.setEncoding('utf-8');
                    this.childProcess.stdout.on("data", (chunk: string) => {
                        this.buffer += chunk;
                        let newlineIndex;
                        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
                            const line = this.buffer.slice(0, newlineIndex);
                            this.buffer = this.buffer.slice(newlineIndex + 1);
                            const trimmed = line.trim();
                            if (trimmed) {
                                try {
                                    const message = JSON.parse(trimmed) as JSONRPCMessage;
                                    if (this.onmessage) this.onmessage(message);
                                } catch {
                                    if (this.onerror) this.onerror(new Error("Failed to parse MCP message: " + trimmed));
                                }
                            }
                        }
                    });

                    this.childProcess.stderr.setEncoding('utf-8');
                    this.childProcess.stderr.on("data", (chunk: string) => {
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

                this.childProcess.on("close", () => {
                    if (this.onclose) this.onclose();
                });
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
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
        await client.connect(transport);

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
                    // eslint-disable-next-line import/no-nodejs-modules -- Desktop-only child_process operations
                    const cpModule = await import("child_process") as unknown as ChildProcessModule;
                    
                    const processLib = process as unknown as { kill: (pid: number) => void; platform: string; };
                    
                    if (processLib.platform === "win32") {
                        const killer = cpModule.spawn("taskkill", ["/pid", String(pid), "/t", "/f"] as string[]);
                        killer.on('error', (error: unknown) => {
                            const err = error instanceof Error ? error : new Error(String(error));
                            logger.warn(`taskkill failed for MCP server ${pid}:`, err);
                        });
                    } else {
                        const killer = cpModule.spawn("pkill", ["-P", String(pid)] as string[]);
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
