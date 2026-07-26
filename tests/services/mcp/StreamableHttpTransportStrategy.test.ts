import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthConnectOptions } from '../../../src/services/mcp/IMcpTransportStrategy';

import { StreamableHttpTransportStrategy } from '../../../src/services/mcp/StreamableHttpTransportStrategy';
import { MCPServerConfig } from '../../../src/settings/types';

// Mock obsidian so `Platform` (imported transitively via the SDK) is
// present and `isExternalUrl`'s indirect dependencies resolve.
vi.mock('obsidian', () => ({
    Platform: { isDesktopApp: true, isMobile: false },
}));

// Stub the logger.
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

// Capture the SDK transport constructor and the client.connect behavior.
// The strategy dynamically imports the SDK module; we mock the resolved
// module so no real transport is constructed. A regular function (not an
// arrow) is used so the mock is callable with `new`.
const fakeTransportInstance = {
    finishAuth: vi.fn(),
};
const TransportConstructor = vi.fn(function (_url: unknown, _opts?: unknown) {
    return fakeTransportInstance;
});

/**
 * Reads the (url, options) arguments passed to the transport constructor.
 * The mock's inferred call signature carries no parameters, so we go
 * through `unknown` to cast safely.
 */
function transportCallArgs(): readonly [URL, {
    authProvider?: unknown;
    eventSourceInit?: unknown;
    fetch?: unknown;
    requestInit?: { headers: Record<string, string> };
}] {
    return TransportConstructor.mock.calls[0] as unknown as readonly [URL, {
        authProvider?: unknown;
        eventSourceInit?: unknown;
        fetch?: unknown;
        requestInit?: { headers: Record<string, string> };
    }];
}

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: TransportConstructor,
}));

// Mock the SDK Client so client.connect resolves by default (success
// path) and we can inspect whether it was constructed with the expected
// metadata.
const clientConnect = vi.fn(async () => {});
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn(function () {
        return { close: vi.fn(), connect: clientConnect };
    }),
}));

// Fake authProvider + fetch for the OAuth path.
function makeOAuthOptions(): OAuthConnectOptions {
    return {
        authProvider: { redirectUrl: undefined } as unknown as OAuthConnectOptions['authProvider'],
        fetch: vi.fn(),
    };
}

function makeServer(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
    return {
        enabled: true,
        id: 'srv',
        name: 'Streamable HTTP',
        requireExplicitConfirmation: false,
        type: 'streamable_http',
        url: 'https://mcp.example.com/endpoint',
        ...overrides,
    };
}

describe('StreamableHttpTransportStrategy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('constructs the transport with only requestInit (no authProvider) for non-OAuth servers', async () => {
        const strategy = new StreamableHttpTransportStrategy();
        const server = makeServer({ remoteHeaders: '{"X-Foo":"bar"}' });
        const resolver = vi.fn(() => 'bar') as unknown as (key: string) => string | null;

        const result = await strategy.connect(server, resolver, false);

        expect(result.needsAuth).toBeUndefined();
        expect(TransportConstructor).toHaveBeenCalledTimes(1);
        const [urlArg, optionsArg] = transportCallArgs();
        expect(urlArg.toString()).toBe('https://mcp.example.com/endpoint');
        expect(optionsArg.requestInit?.headers).toEqual({ 'X-Foo': 'bar' });
        expect(optionsArg.authProvider).toBeUndefined();
        expect(clientConnect).toHaveBeenCalledTimes(1);
    });

    it('forwards authProvider and fetch to the transport constructor for OAuth servers', async () => {
        const strategy = new StreamableHttpTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: ['a', 'b'] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await strategy.connect(server, resolver, false, oauthOptions);

        const optionsArg = transportCallArgs()[1];
        expect(optionsArg.authProvider).toBe(oauthOptions.authProvider);
        expect(optionsArg.fetch).toBe(oauthOptions.fetch);
        // Headers still flow into requestInit for OAuth servers.
        expect(optionsArg.requestInit?.headers).toEqual({});
    });

    it('reports needsAuth when client.connect throws UnauthorizedError and an authProvider is present', async () => {
        const UnauthorizedError = (await import('@modelcontextprotocol/sdk/client/auth.js')).UnauthorizedError;
        clientConnect.mockRejectedValueOnce(new UnauthorizedError('no token'));
        const strategy = new StreamableHttpTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: [] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        const result = await strategy.connect(server, resolver, false, oauthOptions);

        // The strategy catches UnauthorizedError and returns the
        // unconnected client + transport with needsAuth set so the
        // manager can drive the interactive flow.
        expect(result.needsAuth).toBe(true);
        expect(result.client).toBeDefined();
        expect(result.transport).toBe(fakeTransportInstance);
    });

    it('propagates non-UnauthorizedError failures as connection errors', async () => {
        clientConnect.mockRejectedValueOnce(new Error('network down'));
        const strategy = new StreamableHttpTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: [] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await expect(strategy.connect(server, resolver, false, oauthOptions))
            .rejects.toThrow('network down');
    });

    it('blocks loopback URLs when allowLocalNetworkAccess is false', async () => {
        const strategy = new StreamableHttpTransportStrategy();
        const server = makeServer({ url: 'http://127.0.0.1:8080/mcp' });
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await expect(strategy.connect(server, resolver, false))
            .rejects.toThrow('Connection blocked by Local Network Access security settings');
        expect(TransportConstructor).not.toHaveBeenCalled();
    });
});