import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthConnectOptions } from '../../../src/services/mcp/IMcpTransportStrategy';

import { SseTransportStrategy } from '../../../src/services/mcp/SseTransportStrategy';
import { MCPServerConfig } from '../../../src/settings/types';

vi.mock('obsidian', () => ({
    Platform: { isDesktopApp: true, isMobile: false },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

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

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
    SSEClientTransport: TransportConstructor,
}));

const clientConnect = vi.fn(async () => {});
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn(function () {
        return { close: vi.fn(), connect: clientConnect };
    }),
}));

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
        name: 'SSE',
        requireExplicitConfirmation: false,
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        ...overrides,
    };
}

describe('SseTransportStrategy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('constructs the transport with only requestInit (no authProvider) for non-OAuth servers', async () => {
        const strategy = new SseTransportStrategy();
        const server = makeServer({ remoteHeaders: '{"X-Foo":"bar"}' });
        const resolver = vi.fn(() => 'bar') as unknown as (key: string) => string | null;

        const result = await strategy.connect(server, resolver, false);

        expect(result.needsAuth).toBeUndefined();
        expect(TransportConstructor).toHaveBeenCalledTimes(1);
        const optionsArg = transportCallArgs()[1];
        expect(optionsArg.requestInit?.headers).toEqual({ 'X-Foo': 'bar' });
        expect(optionsArg.authProvider).toBeUndefined();
        expect(clientConnect).toHaveBeenCalledTimes(1);
    });

    it('forwards authProvider and fetch without eventSourceInit for OAuth servers', async () => {
        const strategy = new SseTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: ['a'] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await strategy.connect(server, resolver, false, oauthOptions);

        const optionsArg = transportCallArgs()[1];
        expect(optionsArg.authProvider).toBe(oauthOptions.authProvider);
        expect(optionsArg.fetch).toBe(oauthOptions.fetch);
        // eventSourceInit MUST be absent: it suppresses the automatic
        // Authorization header attachment when authProvider is given
        // (sse.d.ts:31-36).
        expect(optionsArg.eventSourceInit).toBeUndefined();
    });

    it('reports needsAuth when client.connect throws UnauthorizedError and an authProvider is present', async () => {
        const UnauthorizedError = (await import('@modelcontextprotocol/sdk/client/auth.js')).UnauthorizedError;
        clientConnect.mockRejectedValueOnce(new UnauthorizedError('no token'));
        const strategy = new SseTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: [] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        const result = await strategy.connect(server, resolver, false, oauthOptions);

        expect(result.needsAuth).toBe(true);
        expect(result.transport).toBe(fakeTransportInstance);
    });

    it('propagates non-UnauthorizedError failures as connection errors', async () => {
        clientConnect.mockRejectedValueOnce(new Error('network down'));
        const strategy = new SseTransportStrategy();
        const server = makeServer({ oauth: { clientId: 'cid', scopes: [] } });
        const oauthOptions = makeOAuthOptions();
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await expect(strategy.connect(server, resolver, false, oauthOptions))
            .rejects.toThrow('network down');
    });

    it('blocks loopback URLs when allowLocalNetworkAccess is false', async () => {
        const strategy = new SseTransportStrategy();
        const server = makeServer({ url: 'http://127.0.0.1:8080/sse' });
        const resolver = vi.fn(() => null) as unknown as (key: string) => string | null;

        await expect(strategy.connect(server, resolver, false))
            .rejects.toThrow('Connection blocked by Local Network Access security settings');
        expect(TransportConstructor).not.toHaveBeenCalled();
    });
});