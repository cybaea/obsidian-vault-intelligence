import { App } from "obsidian";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { McpClientManager } from "../../src/services/McpClientManager";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS, MCPServerConfig } from "../../src/settings/types";

// Mock child_process globally so NativeStdioTransport works
const mockSpawn = vi.fn().mockImplementation(() => ({
    kill: vi.fn(),
    on: vi.fn(),
    pid: 12345,
    stderr: { on: vi.fn(), setEncoding: vi.fn() },
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn(), setEncoding: vi.fn() }
}));

vi.mock('child_process', () => ({
    spawn: mockSpawn
}));

vi.mock('obsidian', () => ({
    Notice: vi.fn(),
    Platform: { isDesktopApp: true, isMobile: false }
}));

// Mock global crypto for testing environment
const mockCryptoSubtle = {
    digest: vi.fn().mockImplementation(() => {
        return new Uint8Array([1, 2, 3, 4, 5]).buffer;
    })
};

Object.defineProperty(globalThis, 'crypto', {
    value: { subtle: mockCryptoSubtle },
});

// Mock localStorage
const mockLocalStorageValue: Record<string, string> = {};
const mockLocalStorage = {
    getItem: vi.fn((k: string) => mockLocalStorageValue[k] || null),
    setItem: vi.fn((k: string, v: string) => { mockLocalStorageValue[k] = v; }),
};

Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
});
Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mockLocalStorage }
});

// Mock environment
Object.defineProperty(globalThis, 'process', {
    value: { env: { HOME: '/home/user', PATH: '/bin', SENSITIVE_KEY: 'secret123' }, platform: 'linux' }
});

describe('McpClientManager', () => {
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockApp = {
            secretStorage: {
                getSecret: vi.fn((k: string) => k === 'valid-secret' ? 'real-secret-value' : null)
            }
        } as unknown as App;

        mockSettings = {
            ...DEFAULT_SETTINGS,
            allowLocalNetworkAccess: false,
            mcpServers: []
        };
        
        Object.keys(mockLocalStorageValue).forEach(k => delete mockLocalStorageValue[k]);
    });

    it('should calculate trust hash correctly for stdio servers', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const serverConfig = {
            args: ['index.js', '--flag'],
            command: 'node',
            enabled: true,
            env: '{"VAR": "test"}',
            id: 'test-server',
            name: 'Test Server',
            requireExplicitConfirmation: true,
            type: 'stdio' as const
        };

        const managerWithInternal = manager as unknown as { generateTrustHash(config: MCPServerConfig): Promise<string> };
        const hash = await managerWithInternal.generateTrustHash(serverConfig);
        
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
        expect(mockCryptoSubtle.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    });

    it('checkTrustState should correctly evaluate legacy trust state (always untrusted)', () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const stdioConfig = { id: 'test-1', type: 'stdio' as const } as MCPServerConfig;
        const sseConfig = { id: 'test-2', type: 'sse' as const } as MCPServerConfig;
        const httpConfig = { id: 'test-3', type: 'streamable_http' as const } as MCPServerConfig;
        
        expect(manager.checkTrustState(stdioConfig).trusted).toBe(false);
        expect(manager.checkTrustState(sseConfig).trusted).toBe(false);
        expect(manager.checkTrustState(httpConfig).trusted).toBe(false);
    });

    it('should strip SENSITIVE_KEY from environment passed to StdioClientTransport', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const serverConfig = {
            args: [],
            command: '/path/to/binary',
            enabled: true,
            id: 'test-server',
            name: 'Test Env Scrub',
            requireExplicitConfirmation: false,
            type: 'stdio' as const
        };

        mockLocalStorageValue[`vi-mcp-trust-${serverConfig.id}`] = '0102030405';

        const managerWithInternal = manager as unknown as { connectServer(config: MCPServerConfig): Promise<void> };
        
        try {
            await managerWithInternal.connectServer(serverConfig as MCPServerConfig);
        } catch {
            // Internal tests may swallow execution failures, but we verify environment injection regardless
        }

        expect(mockSpawn).toHaveBeenCalled();
        const firstCall = mockSpawn.mock.calls[0] as unknown[];
        if (!firstCall) throw new Error("Expected call arguments");
        
        const transportConfigEnv = (firstCall[2] as { env?: Record<string, string> }).env;
        
        expect(transportConfigEnv).toBeDefined();
        if (transportConfigEnv) {
            expect(transportConfigEnv['SENSITIVE_KEY']).toBeUndefined();
            expect(transportConfigEnv['PATH']).toContain('/bin');
            expect(transportConfigEnv['OBSIDIAN_VAULT_INTELLIGENCE']).toBe('true');
        }
    });

    it('should block remote connections if trust hash is invalid (Trust Hash Bypass fix)', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const remoteServerConfig = {
            id: 'test-remote',
            name: 'Remote Server',
            type: 'streamable_http' as const,
            url: 'http://example.com/mcp'
        } as MCPServerConfig;

        const managerWithInternal = manager as unknown as { 
            connectServer(config: MCPServerConfig): Promise<void>; 
            connections: Map<string, { status: string; errorMessage?: string; }>;
        };
        
        await managerWithInternal.connectServer(remoteServerConfig);
        
        const connection = managerWithInternal.connections.get(remoteServerConfig.id);
        expect(connection).toBeDefined();
        expect(connection?.status).toBe('untrusted');
        expect(connection?.errorMessage).toContain('Untrusted configuration');
    });

    it('should block remote connections if SSRF protection is triggered (allowLocalNetworkAccess = false)', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const localServerConfig = {
            enabled: true,
            id: 'test-ssrf',
            name: 'Malicious Local Server',
            requireExplicitConfirmation: false,
            type: 'streamable_http' as const,
            url: 'http://169.254.169.254/latest/meta-data/'
        };

        const managerWithInternal = manager as unknown as { 
            connectServer(config: MCPServerConfig): Promise<void>; 
            connections: Map<string, { status: string; errorMessage?: string; }>;
        };
        
        mockLocalStorageValue[`vi-mcp-trust-${localServerConfig.id}`] = '0102030405';
        await managerWithInternal.connectServer(localServerConfig as MCPServerConfig);
        
        const connection = managerWithInternal.connections.get(localServerConfig.id);
        expect(connection).toBeDefined();
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Connection blocked by Local Network Access security settings');
    });

    it('should enforce gentle fallback for missing secrets', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const sseConfig = {
            id: 'test-sse-secrets',
            name: 'Remote Server Secrets',
            remoteHeaders: JSON.stringify({
                "Authorization": "vi-secret:invalid-secret"
            }),
            type: 'sse' as const,
            url: 'https://example.com/sse'
        };

        mockLocalStorageValue[`vi-mcp-trust-${sseConfig.id}`] = '0102030405';

        const managerWithInternal = manager as unknown as { 
            connectServer(config: MCPServerConfig): Promise<void>; 
            connections: Map<string, { status: string; errorMessage?: string; }>;
        };
        
        await managerWithInternal.connectServer(sseConfig as MCPServerConfig);
        const connection = managerWithInternal.connections.get(sseConfig.id);
        
        expect(connection).toBeDefined();
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Missing secret for Authorization');
    });

    it('should abort MCP tool execution if AbortSignal is used', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const managerWithInternal = manager as unknown as { 
            connections: Map<string, unknown>; 
            toolNameMap: Map<string, unknown>;
        };

        managerWithInternal.connections.set('test-server', {
            client: {
                callTool: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))
            },
            config: { id: 'test-server', name: 'Test Server', type: 'stdio' },
            status: 'connected'
        } as unknown);

        managerWithInternal.toolNameMap.set('mcp__test-server__long-tool', {
            originalName: 'long-tool',
            serverId: 'test-server'
        });

        const controller = new AbortController();
        const promise = manager.executeTool('mcp__test-server__long-tool', {}, controller.signal);
        
        controller.abort();
        const result = await promise;
        
        expect(result.text).toBe("[Tool execution was cancelled by the user]");
    });

    it('should list available MCP resources', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const managerWithInternal = manager as unknown as { 
            connections: Map<string, unknown>; 
        };

        managerWithInternal.connections.set('test-server', {
            client: {
                listResources: vi.fn().mockResolvedValue({ 
                    resources: [{ name: 'Database Schema', uri: 'file:///schema.sql' }] 
                })
            },
            config: { id: 'test-server', name: 'Test Server', type: 'stdio' },
            status: 'connected'
        } as unknown);

        const resources = await manager.getAvailableResources();
        expect(resources).toHaveLength(1);
        expect(resources[0]?.id).toBe('mcp__test-server__file:///schema.sql');
    });

    it('should use cp.spawn to kill zombie processes on terminate (prevent command injection)', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const managerWithInternal = manager as unknown as { 
            connections: Map<string, unknown>; 
        };

        const mockKill = vi.fn();
        const originalProcessKill = (globalThis.process as unknown as { kill: typeof mockKill }).kill;
        (globalThis.process as unknown as { kill: typeof mockKill }).kill = mockKill;
        
        const originalPlatform = globalThis.process.platform;
        Object.defineProperty(globalThis.process, 'platform', { configurable: true, value: 'linux' });

        const { StdioTransportStrategy } = await import('../../src/services/mcp/StdioTransportStrategy');
        managerWithInternal.connections.set('test-server', {
            client: {
                close: vi.fn().mockResolvedValue(undefined)
            },
            config: { id: 'test-server', name: 'Test Server', type: 'stdio' },
            status: 'connected',
            strategy: new StdioTransportStrategy(),
            transport: { pid: 12345 }
        });

        mockSpawn.mockClear();

        try {
            await manager.terminate();
            
            expect(mockSpawn).toHaveBeenCalledWith('pkill', ['-P', '12345']);
            
        } finally {
            Object.defineProperty(globalThis.process, 'platform', { configurable: true, value: originalPlatform });
            
            if (originalProcessKill !== undefined) {
                (globalThis.process as unknown as { kill: typeof mockKill }).kill = originalProcessKill;
            } else {
                delete (globalThis.process as unknown as { kill?: typeof mockKill }).kill;
            }
        }
    });
});
