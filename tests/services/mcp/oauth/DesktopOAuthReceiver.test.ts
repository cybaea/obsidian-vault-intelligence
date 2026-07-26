import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    createDesktopOAuthReceiverWithFactory,
    DesktopOAuthReceiver,
    HttpServerFactory,
    HttpServerLike,
    OAuthRedirectError,
} from '../../../../src/services/mcp/oauth/DesktopOAuthReceiver';

// Mock obsidian's Platform so we can toggle isDesktopApp for the guard
// test. The default mock (tests/mocks/obsidian.ts) sets isDesktopApp to
// true; we override here so individual tests can flip it to false.
// vi.hoisted ensures the mock object exists before the hoisted vi.mock
// factory runs.
const { platformMock } = vi.hoisted(() => ({ platformMock: { isDesktopApp: true, isMobile: false } }));
vi.mock('obsidian', () => ({
    Platform: platformMock,
}));

/**
 * Fake HTTP server that captures the request handler so tests can drive
 * it directly without binding a real socket.
 *
 * The `listen` callback is invoked synchronously so `start()` proceeds
 * immediately. `address()` returns a fixed port (54321) so the redirect
 * URL is deterministic. `close()` records the call and invokes its
 * callback synchronously.
 */
interface FakeServer extends HttpServerLike {
    closeCalls: number;
    handler: ((req: { url: string | undefined }, res: FakeResponse) => void) | null;
    listenCalls: number;
    listenHost: string | null;
    listenPort: number | null;
}

/**
 * Fake response object that records the status, headers, and body the
 * handler writes. Tests assert on these to verify the success/error
 * pages served to the browser.
 */
interface FakeResponse {
    body: string;
    end: Mock<(body: string) => void>;
    headers: Record<string, string>;
    setHeader: Mock<(name: string, value: string) => void>;
    status: number;
    writeHead: Mock<(status: number, headers?: Record<string, string>) => void>;
}

function makeFakeResponse(): FakeResponse {
    const res: FakeResponse = {
        body: '',
        end: vi.fn((body: string) => { res.body = body; }),
        headers: {},
        setHeader: vi.fn((name: string, value: string) => { res.headers[name] = value; }),
        status: 0,
        writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
            res.status = status;
            if (headers) {
                for (const [k, v] of Object.entries(headers)) {
                    res.headers[k] = v;
                }
            }
        }),
    };
    return res;
}

function makeFakeServer(): FakeServer {
    const server: FakeServer = {
        address: () => ({ port: 54321 }),
        close(callback?: () => void) {
            server.closeCalls++;
            if (callback) callback();
        },
        closeCalls: 0,
        handler: null,
        listen(port: number, host: string, callback: () => void) {
            server.listenCalls++;
            server.listenPort = port;
            server.listenHost = host;
            callback();
        },
        listenCalls: 0,
        listenHost: null,
        listenPort: null,
    };
    return server;
}

function makeFakeFactory(): { factory: HttpServerFactory; server: FakeServer } {
    const server = makeFakeServer();
    const factory: HttpServerFactory = {
        createServer(handler) {
            // Cast the handler to accept our FakeResponse; the production
            // handler only uses the `url`, `end`, `setHeader`, and
            // `writeHead` members we expose on FakeResponse.
            server.handler = handler;
            return server;
        },
    };
    return { factory, server };
}

describe('DesktopOAuthReceiver', () => {
    let receiver: DesktopOAuthReceiver;
    let fakeFactory: { factory: HttpServerFactory; server: FakeServer };

    beforeEach(() => {
        vi.clearAllMocks();
        platformMock.isDesktopApp = true;
        fakeFactory = makeFakeFactory();
        receiver = createDesktopOAuthReceiverWithFactory(fakeFactory.factory);
    });

    describe('start', () => {
        it('binds to 127.0.0.1 on port 0 and exposes the OS-assigned port', async () => {
            const { port, redirectUrl, waitForCode } = await receiver.start('state-abc');
            expect(port).toBe(54321);
            expect(redirectUrl.href).toBe('http://127.0.0.1:54321/callback');
            expect(fakeFactory.server.listenPort).toBe(0);
            expect(fakeFactory.server.listenHost).toBe('127.0.0.1');
            // Clean up the dangling promise so the test process can exit.
            void receiver.stop();
            // Suppress the unhandled rejection from the abandoned promise.
            waitForCode.catch(() => { /* expected: timed out or stopped */ });
        });

        it('rejects on mobile (Platform.isDesktopApp is false)', async () => {
            platformMock.isDesktopApp = false;
            await expect(receiver.start('state-abc')).rejects.toThrow(
                'OAuth loopback receiver requires desktop',
            );
        });
    });

    describe('valid redirect', () => {
        it('captures the code when state matches', async () => {
            const { waitForCode } = await receiver.start('state-xyz');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?code=auth-code-123&state=state-xyz' },
                res,
            );
            const result = await waitForCode;
            expect(result).toEqual({ code: 'auth-code-123', state: 'state-xyz' });
        });

        it('serves a success page that includes window.close()', async () => {
            const { waitForCode } = await receiver.start('state-xyz');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?code=auth-code-123&state=state-xyz' },
                res,
            );
            await waitForCode;
            expect(res.status).toBe(200);
            expect(res.headers['Content-Type']).toContain('text/html');
            expect(res.body).toContain('window.close()');
            expect(res.body).toContain('Authorization successful');
        });

        it('percent-decodes code and state parameters', async () => {
            const { waitForCode } = await receiver.start('state with space');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?code=abc%20def&state=state%20with%20space' },
                res,
            );
            const result = await waitForCode;
            expect(result.code).toBe('abc def');
            expect(result.state).toBe('state with space');
        });
    });

    describe('state mismatch', () => {
        it('rejects with a CSRF error when state does not match', async () => {
            const { waitForCode } = await receiver.start('expected-state');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?code=auth-code&state=wrong-state' },
                res,
            );
            await expect(waitForCode).rejects.toThrow('state mismatch');
        });

        it('serves an error page without window.close() on state mismatch', async () => {
            const { waitForCode } = await receiver.start('expected-state');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?code=auth-code&state=wrong-state' },
                res,
            );
            await expect(waitForCode).rejects.toThrow();
            expect(res.body).toContain('state parameter mismatch');
            expect(res.body).not.toContain('window.close()');
        });
    });

    describe('error param (R1)', () => {
        it('rejects with OAuthRedirectError when error param is present', async () => {
            const { waitForCode } = await receiver.start('state-abc');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?error=access_denied&error_description=user%20denied&state=state-abc' },
                res,
            );
            await expect(waitForCode).rejects.toSatisfy((err: unknown) => {
                const e = err as OAuthRedirectError;
                return e.error === 'access_denied' && e.errorDescription === 'user denied';
            });
        });

        it('exposes error and errorDescription on the rejection', async () => {
            const { waitForCode } = await receiver.start('state-abc');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?error=invalid_request&error_description=bad%20scope' },
                res,
            );
            try {
                await waitForCode;
                throw new Error('expected rejection');
            } catch (e) {
                const redirectError = e as OAuthRedirectError;
                expect(redirectError.error).toBe('invalid_request');
                expect(redirectError.errorDescription).toBe('bad scope');
                expect(redirectError.message).toContain('invalid_request');
            }
        });

        it('serves a denied page without window.close() on error redirect', async () => {
            const { waitForCode } = await receiver.start('state-abc');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?error=access_denied&error_description=user%20denied' },
                res,
            );
            await expect(waitForCode).rejects.toThrow();
            expect(res.body).toContain('Authorization denied');
            expect(res.body).toContain('access_denied');
            expect(res.body).toContain('user denied');
            expect(res.body).not.toContain('window.close()');
        });

        it('escapes HTML in the error and errorDescription to prevent reflected XSS', async () => {
            const { waitForCode } = await receiver.start('state-abc');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.(
                { url: '/callback?error=<script>alert(1)</script>&error_description=<img%20src=x%20onerror=alert(2)>' },
                res,
            );
            await expect(waitForCode).rejects.toThrow();
            expect(res.body).not.toContain('<script>');
            expect(res.body).not.toContain('<img');
            expect(res.body).toContain('&lt;script&gt;');
            expect(res.body).toContain('&lt;img');
        });
    });

    describe('stray requests', () => {
        it('does not resolve or reject on a request without code or error', async () => {
            const { waitForCode } = await receiver.start('state-abc');
            const res = makeFakeResponse();
            fakeFactory.server.handler?.({ url: '/favicon.ico' }, res);
            // The promise should remain pending. Use a short race to assert it
            // does not settle.
            const settled = await Promise.race([
                waitForCode.then(() => true, () => true),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
            ]);
            expect(settled).toBe(false);
            expect(res.body).toContain('Waiting for authorization redirect');
            void receiver.stop();
            waitForCode.catch(() => { /* suppressed */ });
        });
    });

    describe('timeout', () => {
        it('rejects when no redirect arrives within timeoutMs', async () => {
            const { waitForCode } = await receiver.start('state-abc', 100);
            await expect(waitForCode).rejects.toThrow('OAuth redirect timed out');
        });

        it('calls stop() after the timeout fires', async () => {
            const { waitForCode } = await receiver.start('state-abc', 100);
            await expect(waitForCode).rejects.toThrow();
            // stop() closes the server; assert it was invoked.
            expect(fakeFactory.server.closeCalls).toBeGreaterThanOrEqual(1);
        });
    });

    describe('stop', () => {
        it('closes the HTTP server', async () => {
            await receiver.start('state-abc');
            expect(fakeFactory.server.closeCalls).toBe(0);
            await receiver.stop();
            expect(fakeFactory.server.closeCalls).toBe(1);
        });

        it('is idempotent', async () => {
            await receiver.start('state-abc');
            await receiver.stop();
            await receiver.stop();
            // The underlying server.close is only called once because the
            // second stop() returns early (stopped flag is set).
            expect(fakeFactory.server.closeCalls).toBe(1);
        });

        it('clears the timeout timer', async () => {
            const { waitForCode } = await receiver.start('state-abc', 100);
            await receiver.stop();
            // After stop, the pending waitForCode should reject with a
            // timeout error (the timeout was already scheduled). But because
            // stop() cleared the timer, it should NOT reject with timeout —
            // instead it stays pending. We assert it does not settle quickly.
            const settled = await Promise.race([
                waitForCode.then(() => true, () => true),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
            ]);
            expect(settled).toBe(false);
            waitForCode.catch(() => { /* suppressed */ });
        });
    });
});