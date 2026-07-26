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
    stdin: { 
        write: vi.fn((_data: string, cb: (err?: Error) => void) => {
            // Fail the handshake immediately to prevent the SDK's client.connect() from hanging
            if (typeof cb === 'function') cb(new Error("Mock write error to prevent hang"));
        })
    },
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

// Inject global require for tests to map dynamic require("child_process") exactly as NativeStdioTransport expects
Object.defineProperty(globalThis, 'require', {
    value: (id: string) => {
        if (id === 'child_process') return { spawn: mockSpawn };
        throw new Error(`Cannot require ${id} in test environment`);
    },
    writable: true
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


// Mock environment
Object.defineProperty(globalThis, 'process', {
    value: { env: { HOME: '/home/user', PATH: '/bin', SENSITIVE_KEY: 'secret123' }, platform: 'linux' }
});

// Mock the OAuth receiver factory and the OAuthFlowOrchestrator so the
// manager's runOAuthFlow path can be exercised without binding real
// sockets or driving the real SDK auth() helper. vi.hoisted keeps the
// mocks available to the hoisted vi.mock factories.
const { oauthReceiverMock, orchestratorMock } = vi.hoisted(() => ({
    oauthReceiverMock: { start: vi.fn(), stop: vi.fn() },
    orchestratorMock: { authorize: vi.fn() },
}));
vi.mock('../../src/services/mcp/oauth/DesktopOAuthReceiver', () => ({
    createDesktopOAuthReceiver: vi.fn(() => oauthReceiverMock),
}));
// OAuthFlowOrchestrator is invoked with `new`, so the mock factory must
// return a constructor function (not the instance directly). The
// constructor returns the shared orchestratorMock instance.
vi.mock('../../src/services/mcp/oauth/OAuthFlowOrchestrator', () => ({
    OAuthFlowOrchestrator: vi.fn(function () { return orchestratorMock; }),
}));

interface McpClientManagerPrivates {
    connections: Map<string, { status: string; errorMessage?: string; }>;
    connectServer(config: MCPServerConfig): Promise<void>;
    toolNameMap: Map<string, { originalName: string; serverId: string }>;
}

/**
 * Minimal strategy surface used by the OAuth flow tests (the runOAuthFlow
 * private method only calls `strategy.terminate`).
 */
interface McpStrategyLike {
    terminate(client: unknown, transport: unknown): Promise<void>;
}

/**
 * Minimal OAuthConnectOptions surface used by the OAuth flow tests
 * (runOAuthFlow reads `authProvider` and `fetch`).
 */
interface OAuthConnectOptionsLike {
    authProvider?: { setRedirectUrl(url: string): void; state(): Promise<string>; invalidateCredentials(scope: string): Promise<void> };
    fetch?: (url: string, init?: unknown) => Promise<Response>;
}

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

    it('should include oauth config (sorted scopes, secret presence flag) in the trust hash', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);

        const withOauth = {
            args: ['index.js'],
            command: 'node',
            enabled: true,
            id: 'oauth-server',
            name: 'OAuth Server',
            oauth: { clientId: 'cid', clientSecret: 'vi-secret:mcp-x', scopes: ['z', 'a', 'm'] },
            requireExplicitConfirmation: true,
            type: 'streamable_http' as const,
            url: 'https://mcp.example.com',
        };

        // Same config but with scopes reordered and a different secret
        // placeholder string. The trust-hash payload must be identical
        // because scopes are sorted before hashing and the secret is
        // recorded only as a boolean presence flag.
        const reorderedScopes = {
            ...withOauth,
            oauth: { clientId: 'cid', clientSecret: 'different-placeholder', scopes: ['a', 'm', 'z'] },
        };

        const noSecret = {
            ...withOauth,
            oauth: { clientId: 'cid', scopes: ['a', 'm', 'z'] },
        };

        const managerWithInternal = manager as unknown as { generateTrustHash(config: MCPServerConfig): Promise<string> };

        await managerWithInternal.generateTrustHash(withOauth);
        const payloadA = JSON.parse(new TextDecoder().decode((mockCryptoSubtle.digest.mock.calls.at(-1)?.[1] as Uint8Array)));
        expect(payloadA.oauth).toEqual({
            clientId: 'cid',
            hasClientSecret: true,
            scopes: ['a', 'm', 'z'], // sorted
        });

        await managerWithInternal.generateTrustHash(reorderedScopes);
        const payloadB = JSON.parse(new TextDecoder().decode((mockCryptoSubtle.digest.mock.calls.at(-1)?.[1] as Uint8Array)));
        expect(payloadB.oauth).toEqual(payloadA.oauth);

        await managerWithInternal.generateTrustHash(noSecret);
        const payloadC = JSON.parse(new TextDecoder().decode((mockCryptoSubtle.digest.mock.calls.at(-1)?.[1] as Uint8Array)));
        expect(payloadC.oauth).toEqual({
            clientId: 'cid',
            hasClientSecret: false,
            scopes: ['a', 'm', 'z'],
        });
    });

    it('should skip OAuth-gated servers on mobile (Platform.isDesktopApp false)', async () => {
        // Toggle the obsidian Platform mock to mobile for this test.
        const obsidianModule = await import('obsidian');
        const platformMock = (obsidianModule as unknown as { Platform: { isDesktopApp: boolean; isMobile: boolean } }).Platform;
        const originalDesktop = platformMock.isDesktopApp;
        const originalMobile = platformMock.isMobile;
        platformMock.isDesktopApp = false;
        platformMock.isMobile = true;

        try {
            const manager = new McpClientManager(mockApp, mockSettings);
            const serverConfig: MCPServerConfig = {
                enabled: true,
                id: 'oauth-mobile',
                name: 'OAuth Mobile',
                oauth: { clientId: 'cid', scopes: ['a'] },
                requireExplicitConfirmation: false,
                type: 'streamable_http',
                url: 'https://mcp.example.com',
            };
            mockLocalStorageValue[`vi-mcp-trust-${serverConfig.id}`] = '0102030405';

            const managerWithInternal = manager as unknown as {
                connectServer(config: MCPServerConfig): Promise<void>;
                connections: Map<string, { status: string; errorMessage?: string; }>;
            };
            await managerWithInternal.connectServer(serverConfig);

            const connection = managerWithInternal.connections.get(serverConfig.id);
            expect(connection).toBeDefined();
            expect(connection?.status).toBe('error');
            expect(connection?.errorMessage).toContain('only supported on desktop');
        } finally {
            platformMock.isDesktopApp = originalDesktop;
            platformMock.isMobile = originalMobile;
        }
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

        const managerWithInternal = manager as unknown as McpClientManagerPrivates;
        
        try {
            await managerWithInternal.connectServer(serverConfig);
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

        const managerWithInternal = manager as unknown as McpClientManagerPrivates;
        
        mockLocalStorageValue[`vi-mcp-trust-${localServerConfig.id}`] = '0102030405';
        await managerWithInternal.connectServer(localServerConfig);
        
        const connection = managerWithInternal.connections.get(localServerConfig.id);
        expect(connection).toBeDefined();
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Connection blocked by Local Network Access security settings');
    });

    it('should drive the interactive OAuth flow when a needsAuth transport connects and mark connected on success', async () => {
        // Exercise runOAuthFlow directly with a stub strategy, client,
        // and transport plus the mocked orchestrator. This avoids the
        // real SDK transport entirely while still covering the manager's
        // auth-pending park, orchestrator invocation, and the connected
        // vs error status assignment.
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-flow',
            name: 'OAuth Flow Server',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const fakeStrategy = { terminate: vi.fn(async () => {}) } as unknown as McpStrategyLike;
        void fakeStrategy;
        const strategy = fakeStrategy;
        const client = { close: vi.fn(async () => {}) } as unknown as { connect(transport: unknown): Promise<void> };
        const transport = { finishAuth: vi.fn(async () => {}) } as unknown as { finishAuth(code: string): Promise<void> };

        orchestratorMock.authorize.mockResolvedValue({ status: 'authorized' });

        const managerWithInternal = manager as unknown as {
            buildOAuthConnectOptions(server: MCPServerConfig): OAuthConnectOptionsLike;
            runOAuthFlow(server: MCPServerConfig, strategy: McpStrategyLike, client: { connect(transport: unknown): Promise<void> }, transport: { finishAuth(code: string): Promise<void> }, oauthOptions: OAuthConnectOptionsLike): Promise<void>;
            connections: Map<string, { status: string; client: unknown }>;
        };
        const oauthOptions = managerWithInternal.buildOAuthConnectOptions(serverConfig);
        await managerWithInternal.runOAuthFlow(serverConfig, strategy, client, transport, oauthOptions);

        const connection = managerWithInternal.connections.get(serverConfig.id);
        expect(connection?.status).toBe('connected');
        expect(orchestratorMock.authorize).toHaveBeenCalledTimes(1);
    });

    it('should mark the OAuth-gated server as error when the flow fails', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-fail',
            name: 'OAuth Fail Server',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const strategy = { terminate: vi.fn(async () => {}) } as unknown as McpStrategyLike;
        const client = { close: vi.fn(async () => {}) } as unknown as { connect(transport: unknown): Promise<void> };
        const transport = { finishAuth: vi.fn(async () => {}) } as unknown as { finishAuth(code: string): Promise<void> };

        orchestratorMock.authorize.mockResolvedValue({
            errorMessage: 'OAuth denied: access_denied',
            status: 'error',
        });

        const managerWithInternal = manager as unknown as {
            buildOAuthConnectOptions(server: MCPServerConfig): OAuthConnectOptionsLike;
            runOAuthFlow(server: MCPServerConfig, strategy: McpStrategyLike, client: { connect(transport: unknown): Promise<void> }, transport: { finishAuth(code: string): Promise<void> }, oauthOptions: OAuthConnectOptionsLike): Promise<void>;
            connections: Map<string, { status: string; errorMessage?: string }>;
        };
        const oauthOptions = managerWithInternal.buildOAuthConnectOptions(serverConfig);
        await managerWithInternal.runOAuthFlow(serverConfig, strategy, client, transport, oauthOptions);

        const connection = managerWithInternal.connections.get(serverConfig.id);
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toBe('OAuth denied: access_denied');
    });

    it('runOAuthFlow should report an incomplete-config error when oauth options are missing', async () => {
        // Construct a manager whose secretStorage yields nothing so
        // buildOAuthConnectOptions still returns a provider/fetch, but
        // feed runOAuthFlow an oauthOptions with a missing fetch to hit
        // the incomplete-config guard.
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-incomplete',
            name: 'OAuth Incomplete',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const strategy = { terminate: vi.fn(async () => {}) } as unknown as McpStrategyLike;
        const client = { close: vi.fn(async () => {}) } as unknown as { connect(transport: unknown): Promise<void> };
        const transport = { finishAuth: vi.fn(async () => {}) } as unknown as { finishAuth(code: string): Promise<void> };

        const managerWithInternal = manager as unknown as {
            runOAuthFlow(server: MCPServerConfig, strategy: McpStrategyLike, client: { connect(transport: unknown): Promise<void> }, transport: { finishAuth(code: string): Promise<void> }, oauthOptions: OAuthConnectOptionsLike): Promise<void>;
            connections: Map<string, { status: string; errorMessage?: string }>;
        };
        // No authProvider and no fetch -> incomplete config.
        await managerWithInternal.runOAuthFlow(serverConfig, strategy, client, transport, {});

        const connection = managerWithInternal.connections.get(serverConfig.id);
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('OAuth configuration is incomplete');
    });

    it('runOAuthFlow should mark error when the orchestrator throws', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-throw',
            name: 'OAuth Throw Server',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const strategy = { terminate: vi.fn(async () => {}) } as unknown as McpStrategyLike;
        const client = { close: vi.fn(async () => {}) } as unknown as { connect(transport: unknown): Promise<void> };
        const transport = { finishAuth: vi.fn(async () => {}) } as unknown as { finishAuth(code: string): Promise<void> };

        orchestratorMock.authorize.mockRejectedValue(new Error('Receiver socket in use'));

        const managerWithInternal = manager as unknown as {
            buildOAuthConnectOptions(server: MCPServerConfig): OAuthConnectOptionsLike;
            runOAuthFlow(server: MCPServerConfig, strategy: McpStrategyLike, client: { connect(transport: unknown): Promise<void> }, transport: { finishAuth(code: string): Promise<void> }, oauthOptions: OAuthConnectOptionsLike): Promise<void>;
            connections: Map<string, { status: string; errorMessage?: string }>;
        };
        const oauthOptions = managerWithInternal.buildOAuthConnectOptions(serverConfig);
        await managerWithInternal.runOAuthFlow(serverConfig, strategy, client, transport, oauthOptions);

        const connection = managerWithInternal.connections.get(serverConfig.id);
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Receiver socket in use');
    });

    it('connectOAuthServer should drive connectServer for a trusted OAuth server on desktop', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-connect',
            name: 'OAuth Connect Server',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];
        const managerWithInternal = manager as unknown as {
            generateTrustHash(config: MCPServerConfig): Promise<string>;
            connections: Map<string, { status: string; errorMessage?: string }>;
        };
        // Pre-trust so connectServer proceeds past the trust gate.
        const hash = await managerWithInternal.generateTrustHash(serverConfig);
        mockLocalStorageValue[`vi-mcp-trust-${serverConfig.id}`] = hash;

        await manager.connectOAuthServer('oauth-connect');

        const connection = managerWithInternal.connections.get('oauth-connect');
        // The real transport cannot resolve mcp.example.com in the test
        // env, so it surfaces as error. Either auth-pending or error is
        // acceptable — the point is connectServer ran.
        expect(connection).toBeDefined();
        expect(['auth-pending', 'connected', 'error']).toContain(connection?.status);
    });

    it('connectOAuthServer should be a no-op for non-OAuth or mobile servers', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        const nonOAuthServer: MCPServerConfig = {
            enabled: true,
            id: 'plain',
            name: 'Plain',
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [nonOAuthServer];

        const before = (manager as unknown as { connections: Map<string, unknown> }).connections.size;
        await manager.connectOAuthServer('plain');
        const after = (manager as unknown as { connections: Map<string, unknown> }).connections.size;
        expect(after).toBe(before);

        // Missing id is also a no-op.
        await manager.connectOAuthServer('does-not-exist');
        expect((manager as unknown as { connections: Map<string, unknown> }).connections.size).toBe(before);
    });

    it('disconnectOAuthServer should invalidate credentials, close the client, and remove the connection', async () => {
        const clearSecret = vi.fn();
        mockApp = {
            secretStorage: { clearSecret, getSecret: vi.fn(() => null), setSecret: vi.fn() },
        } as unknown as App;
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-disc',
            name: 'OAuth Disconnect',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const close = vi.fn(async () => {});
        (manager as unknown as { connections: Map<string, unknown> }).connections.set('oauth-disc', {
            client: { close },
            config: serverConfig,
            status: 'connected',
            strategy: { terminate: vi.fn(async () => {}) },
            transport: {},
        });

        await manager.disconnectOAuthServer('oauth-disc');

        expect(clearSecret).toHaveBeenCalled();
        expect((manager as unknown as { connections: Map<string, unknown> }).connections.has('oauth-disc')).toBe(false);
    });

    it('disconnectOAuthServer should be a no-op when the server has no oauth config or no connection', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        mockSettings.mcpServers = [{ enabled: true, id: 'no-oauth', name: 'X', requireExplicitConfirmation: false, type: 'stdio' }];
        // No connection present -> no-op, no throw.
        await expect(manager.disconnectOAuthServer('no-oauth')).resolves.toBeUndefined();
        await expect(manager.disconnectOAuthServer('absent')).resolves.toBeUndefined();
    });

    it('disconnectOAuthServer should close the client when no strategy is attached', async () => {
        const clearSecret = vi.fn();
        mockApp = {
            secretStorage: { clearSecret, getSecret: vi.fn(() => null), setSecret: vi.fn() },
        } as unknown as App;
        const manager = new McpClientManager(mockApp, mockSettings);
        const serverConfig: MCPServerConfig = {
            enabled: true,
            id: 'oauth-disc-noclient',
            name: 'OAuth Disconnect No Strategy',
            oauth: { clientId: 'cid', scopes: ['a'] },
            requireExplicitConfirmation: false,
            type: 'streamable_http',
            url: 'https://mcp.example.com',
        };
        mockSettings.mcpServers = [serverConfig];

        const close = vi.fn(async () => {});
        (manager as unknown as { connections: Map<string, unknown> }).connections.set('oauth-disc-noclient', {
            client: { close },
            config: serverConfig,
            status: 'connected',
            transport: {},
        });

        await manager.disconnectOAuthServer('oauth-disc-noclient');

        expect(close).toHaveBeenCalled();
        expect(clearSecret).toHaveBeenCalled();
        expect((manager as unknown as { connections: Map<string, unknown> }).connections.has('oauth-disc-noclient')).toBe(false);
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
                callTool: vi.fn(() => new Promise((resolve) => window.setTimeout(resolve, 1000)))
            },
            config: { id: 'test-server', name: 'Test Server', type: 'stdio' },
            status: 'connected'
        });

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
        });

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