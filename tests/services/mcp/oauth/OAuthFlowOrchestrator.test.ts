import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type {
    DesktopOAuthReceiver,
    OAuthRedirectResult,
} from '../../../../src/services/mcp/oauth/DesktopOAuthReceiver';
import type { ObsidianOAuthClientProvider } from '../../../../src/services/mcp/oauth/ObsidianOAuthClientProvider';

import { OAuthFlowOrchestrator } from '../../../../src/services/mcp/oauth/OAuthFlowOrchestrator';

// Mock the SDK auth() helper. The orchestrator depends only on the
// `auth` named export; we replace it with a spy so no real discovery
// or token exchange happens. Each test configures the return value
// (and whether it throws) to drive a specific branch. vi.hoisted
// ensures the spy exists before the hoisted vi.mock factory runs.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
    auth: authMock,
}));

// Stub the logger so info/error calls do not spam the test console.
vi.mock('../../../../src/utils/logger', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

interface StubProvider extends ObsidianOAuthClientProvider {
    setRedirectUrl: Mock;
    state: Mock;
}

interface StubReceiver extends DesktopOAuthReceiver {
    start: Mock;
    stop: Mock;
}

interface StubTransport {
    finishAuth: Mock;
}

interface StubClient {
    connect: Mock;
}

function makeProvider(): StubProvider {
    return {
        setRedirectUrl: vi.fn(),
        state: vi.fn(async () => 'stub-state'),
    } as unknown as StubProvider;
}

function makeReceiver(waitForCodeValue: Promise<OAuthRedirectResult>): StubReceiver {
    return {
        start: vi.fn(async () => ({
            port: 54321,
            redirectUrl: new URL('http://127.0.0.1:54321/callback'),
            waitForCode: waitForCodeValue,
        })),
        stop: vi.fn(async () => {}),
    };
}

function makeTransport(): StubTransport {
    return { finishAuth: vi.fn(async () => {}) };
}

function makeClient(): StubClient {
    return { connect: vi.fn(async () => {}) };
}

describe('OAuthFlowOrchestrator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns authorized without a browser flow when auth() returns AUTHORIZED', async () => {
        authMock.mockResolvedValue('AUTHORIZED');
        const provider = makeProvider();
        const receiver = makeReceiver(new Promise(() => {}));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('authorized');
        expect(authMock).toHaveBeenCalledWith(provider, {
            fetchFn,
            serverUrl: 'https://mcp.example.com',
        });
        expect(provider.setRedirectUrl).toHaveBeenCalledWith('http://127.0.0.1:54321/callback');
        // No browser flow: transport.finishAuth and client.connect retry
        // are NOT invoked.
        expect(transport.finishAuth).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
        // Receiver is still torn down.
        expect(receiver.stop).toHaveBeenCalled();
    });

    it('exchanges the code and retries the connection when auth() returns REDIRECT', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        const redirectResult: OAuthRedirectResult = { code: 'abc123', state: 'stub-state' };
        const receiver = makeReceiver(Promise.resolve(redirectResult));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('authorized');
        expect(transport.finishAuth).toHaveBeenCalledWith('abc123');
        expect(client.connect).toHaveBeenCalledWith(transport);
        expect(receiver.stop).toHaveBeenCalled();
    });

    it('surfaces a receiver rejection as an error result', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        const receiver = makeReceiver(Promise.reject(new Error('OAuth redirect timed out')));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('OAuth redirect timed out');
        // No token exchange or retry.
        expect(transport.finishAuth).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
        // Receiver is still torn down in the finally block.
        expect(receiver.stop).toHaveBeenCalled();
    });

    it('surfaces a CSRF state mismatch rejection with a meaningful message', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        const stateError = new Error('OAuth redirect state mismatch (possible CSRF attack)');
        const receiver = makeReceiver(Promise.reject(stateError));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('error');
        expect(result.errorMessage).toContain('state mismatch');
    });

    it('surfaces a consent-denied OAuthRedirectError with error and errorDescription', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        // Simulate the receiver rejecting with an OAuthRedirectError-shaped
        // object (created via Object.defineProperty in production).
        const redirectError = new Error('OAuth redirect error: access_denied (User denied)');
        Object.defineProperty(redirectError, 'error', { value: 'access_denied', writable: false });
        Object.defineProperty(redirectError, 'errorDescription', { value: 'User denied', writable: false });
        const receiver = makeReceiver(Promise.reject(redirectError));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('OAuth denied: access_denied (User denied)');
    });

    it('surfaces a finishAuth failure as an error result', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        const redirectResult: OAuthRedirectResult = { code: 'abc123', state: 'stub-state' };
        const receiver = makeReceiver(Promise.resolve(redirectResult));
        const transport = makeTransport();
        transport.finishAuth.mockRejectedValue(new Error('Token exchange failed'));
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('Token exchange failed');
        // No connect retry after a failed exchange.
        expect(client.connect).not.toHaveBeenCalled();
        expect(receiver.stop).toHaveBeenCalled();
    });

    it('surfaces a client.connect retry failure as an error result', async () => {
        authMock.mockResolvedValue('REDIRECT');
        const provider = makeProvider();
        const redirectResult: OAuthRedirectResult = { code: 'abc123', state: 'stub-state' };
        const receiver = makeReceiver(Promise.resolve(redirectResult));
        const transport = makeTransport();
        const client = makeClient();
        client.connect.mockRejectedValue(new Error('Retry connect failed'));
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        const result = await orchestrator.authorize();

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('Retry connect failed');
        expect(receiver.stop).toHaveBeenCalled();
    });

    it('starts the receiver and sets the redirectUrl before calling auth()', async () => {
        authMock.mockImplementation(async () => {
            // Assert the receiver was started and the redirect URL was
            // set on the provider before auth() runs.
            expect(receiver.start).toHaveBeenCalledWith('stub-state');
            expect(provider.setRedirectUrl).toHaveBeenCalledWith('http://127.0.0.1:54321/callback');
            return 'AUTHORIZED';
        });
        const provider = makeProvider();
        const receiver = makeReceiver(new Promise(() => {}));
        const transport = makeTransport();
        const client = makeClient();
        const fetchFn = vi.fn();

        const orchestrator = new OAuthFlowOrchestrator(
            provider, receiver, transport, client, transport,
            'https://mcp.example.com', fetchFn,
        );

        await orchestrator.authorize();
    });
});