import { Platform } from "obsidian";

/**
 * A successful OAuth redirect: the authorization server redirected the
 * user agent back to the loopback receiver with a `code` and a `state`
 * that matched the value we sent.
 */
export interface OAuthRedirectResult {
    readonly code: string;
    readonly state: string;
}

/**
 * An OAuth error redirect.
 *
 * The authorization server may redirect with an `error` parameter (and an
 * optional `error_description`) instead of a `code` when the user denies
 * consent or the server rejects the request. We surface both fields so the
 * orchestrator can show a meaningful message to the user.
 */
export interface OAuthRedirectError extends Error {
    readonly error: string;
    readonly errorDescription?: string;
}

/**
 * Creates an {@link OAuthRedirectError} with the `error` and optional
 * `errorDescription` exposed as readonly properties alongside the standard
 * `Error` fields.
 */
function createRedirectError(error: string, errorDescription?: string): OAuthRedirectError {
    const message = errorDescription
        ? `OAuth redirect error: ${error} (${errorDescription})`
        : `OAuth redirect error: ${error}`;
    const e = new Error(message) as OAuthRedirectError;
    Object.defineProperty(e, "error", { enumerable: true, value: error, writable: false });
    Object.defineProperty(e, "errorDescription", {
        enumerable: true,
        value: errorDescription,
        writable: false,
    });
    return e;
}

/**
 * The minimal HTTP server surface the receiver depends on.
 *
 * This abstraction exists so tests can inject a fake factory that returns a
 * mock server, avoiding the need to bind real sockets in the test
 * environment (following the established mock-injection pattern used by
 * `McpClientManager.test.ts` and the other OAuth tests).
 *
 * The shape mirrors the subset of Node's `http.Server` the receiver
 * actually uses: `listen`, `address`, and `close`. `listen` accepts a
 * host, port, and callback so we can read the OS-assigned port from
 * `address()` after the kernel allocates one (port 0).
 */
export interface HttpServerLike {
    address(): { port: number } | null;
    close(callback?: () => void): void;
    listen(port: number, host: string, callback: () => void): void;
}

/**
 * Factory that creates an {@link HttpServerLike} for a request handler.
 *
 * In production, {@link createNodeHttpServerFactory} wraps
 * `http.createServer`. In tests, a fake factory returns a mock server
 * whose handler can be invoked directly to simulate browser redirects.
 *
 * The handler receives the request URL string (the path plus query of
 * `req.url`) and a response writer that accepts a status code, headers,
 * and a body. Keeping the handler arguments as primitives (rather than
 * the full `IncomingMessage`/`ServerResponse`) avoids pulling Node's
 * `http` types into production code that must remain cross-platform safe
 * at the type level (Node APIs are not available on Obsidian mobile).
 */
export interface HttpServerFactory {
    createServer(handler: (req: { url: string | undefined }, res: {
        end(body: string): void;
        setHeader(name: string, value: string): void;
        writeHead(status: number, headers?: Record<string, string>): void;
    }) => void): HttpServerLike;
}

/**
 * Loopback OAuth redirect receiver for Obsidian desktop.
 *
 * Spins up a transient `http` server on `127.0.0.1:0` (OS-assigned port),
 * awaits the authorization server's redirect, validates the `state`
 * parameter, and resolves the authorization code. Handles OAuth error
 * redirects and CSRF state mismatches from day one.
 *
 * Desktop-only: the `http` module is loaded via the runtime-discovered
 * `require` gated by `Platform.isDesktopApp`, mirroring the established
 * pattern in `StdioTransportStrategy`. On mobile, `start()` rejects with a
 * clear message so the orchestrator can surface a "not supported on
 * mobile" UI without crashing.
 *
 * The receiver is single-use: call `start()` to begin listening, await the
 * returned `waitForCode` promise, then call `stop()` to release the
 * socket. `stop()` is idempotent.
 */
export interface DesktopOAuthReceiver {
    start(expectedState: string, timeoutMs?: number): Promise<{
        port: number;
        redirectUrl: URL;
        waitForCode: Promise<OAuthRedirectResult>;
    }>;
    stop(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 300_000;

const SUCCESS_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization successful</title></head>
<body>
<p>Authorization successful. Return to Obsidian.</p>
<script>window.close();</script>
</body>
</html>`;

const DENIED_PAGE = (error: string, description?: string): string => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization denied</title></head>
<body>
<p>Authorization denied: ${escapeHtml(error)}${description ? ` (${escapeHtml(description)})` : ""}.</p>
<p>You can close this tab and return to Obsidian.</p>
</body>
</html>`;

const STATE_MISMATCH_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization error</title></head>
<body>
<p>Authorization error: state parameter mismatch (possible CSRF attack).</p>
<p>You can close this tab and return to Obsidian.</p>
</body>
</html>`;

/**
 * Escapes HTML-special characters so server-supplied error strings cannot
 * inject markup into the response page served to the browser.
 *
 * The authorization server controls the `error` and `error_description`
 * values, so they are untrusted from the perspective of the page we
 * render. Escaping prevents reflected XSS via the loopback response.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Creates a production {@link HttpServerFactory} backed by Node's `http`
 * module.
 *
 * The `http` module is loaded via the runtime-discovered `require` (the
 * same pattern used by `StdioTransportStrategy`) rather than a static
 * `import("http")`. This keeps the module out of the esbuild bundle graph
 * and avoids loading Node built-ins on Obsidian mobile, where they are
 * unavailable. The `Platform.isDesktopApp` guard in `start()` ensures
 * this function is never called on mobile.
 */
function createNodeHttpServerFactory(): HttpServerFactory {
    // Dynamically pull native require to completely bypass esbuild
    // bundling while remaining strictly typed (mirrors
    // StdioTransportStrategy's pattern).
    const req = (typeof window !== "undefined" && "require" in window)
        ? (window as unknown as { require: (id: string) => unknown }).require
        : (activeDocument.win as unknown as { require?: (id: string) => unknown }).require;

    if (typeof req !== "function") {
        throw new Error("Native require is not available in this environment");
    }

    const http = req("http") as {
        createServer: (handler: (req: { url?: string }, res: {
            end: (body?: string) => void;
            setHeader: (name: string, value: string) => void;
            writeHead: (status: number, headers?: Record<string, string>) => void;
        }) => void) => {
            address: () => { port: number } | null;
            close: (callback?: () => void) => void;
            listen: (port: number, host: string, callback: () => void) => void;
        };
    };

    return {
        createServer(handler) {
            const server = http.createServer((req, res) => {
                handler(
                    { url: req.url },
                    {
                        end(body: string) { res.end(body); },
                        setHeader(name: string, value: string) { res.setHeader(name, value); },
                        writeHead(status: number, headers?: Record<string, string>) {
                            if (headers) {
                                res.writeHead(status, headers);
                            } else {
                                res.writeHead(status);
                            }
                        },
                    },
                );
            });
            return {
                address() {
                    return server.address();
                },
                close(callback?: () => void) {
                    server.close(callback);
                },
                listen(port, host, callback) {
                    server.listen(port, host, callback);
                },
            };
        },
    };
}

/**
 * Default implementation of {@link DesktopOAuthReceiver}.
 *
 * The receiver is created with a factory so tests can inject a fake. In
 * production, the factory is obtained lazily inside `start()` via
 * {@link createNodeHttpServerFactory} (which performs the desktop-gated
 * runtime `require("http")`).
 */
class DefaultDesktopOAuthReceiver implements DesktopOAuthReceiver {
    private server: HttpServerLike | null = null;
    private timeoutHandle: number | null = null;
    private stopped = false;

    constructor(private readonly serverFactory: HttpServerFactory) {}

    public async start(expectedState: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<{
        port: number;
        redirectUrl: URL;
        waitForCode: Promise<OAuthRedirectResult>;
    }> {
        if (!Platform.isDesktopApp) {
            throw new Error("OAuth loopback receiver requires desktop");
        }

        let resolveCode: ((result: OAuthRedirectResult) => void) | undefined;
        let rejectCode: ((error: Error) => void) | undefined;
        const waitForCode = new Promise<OAuthRedirectResult>((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
        });

        const server = this.serverFactory.createServer((req, res) => {
            this.handleRequest(req.url, expectedState, res, resolveCode, rejectCode);
        });
        this.server = server;

        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", () => resolve());
        });

        const address = server.address();
        if (!address) {
            throw new Error("Loopback HTTP server failed to bind");
        }
        const port = address.port;
        const redirectUrl = new URL(`http://127.0.0.1:${port}/callback`);

        // The timeout fires when no redirect arrives within timeoutMs.
        // There is no request response to write to (no request has
        // arrived), so the timeout only rejects the promise and tears
        // down the listener. Avoiding a stale `res` closure here is
        // important: the `res` parameter of `start` does not exist (the
        // handler gets its own `res` per request), so the timeout must
        // not reference any response object.
        this.timeoutHandle = window.setTimeout(() => {
            if (!this.stopped) {
                rejectCode?.(new Error("OAuth redirect timed out"));
                void this.stop();
            }
        }, timeoutMs);

        return { port, redirectUrl, waitForCode };
    }

    private handleRequest(
        url: string | undefined,
        expectedState: string,
        res: {
            end(body: string): void;
            setHeader(name: string, value: string): void;
            writeHead(status: number, headers?: Record<string, string>): void;
        },
        resolveCode: ((result: OAuthRedirectResult) => void) | undefined,
        rejectCode: ((error: Error) => void) | undefined,
    ): void {
        const params = parseQuery(url);

        const error = params.get("error");
        if (error) {
            const errorDescription = params.get("error_description") ?? undefined;
            rejectCode?.(createRedirectError(error, errorDescription));
            this.serveStaticPage(res, DENIED_PAGE(error, errorDescription));
            void this.stop();
            return;
        }

        const code = params.get("code");
        const state = params.get("state");
        if (code && state === expectedState) {
            resolveCode?.({ code, state });
            this.serveStaticPage(res, SUCCESS_PAGE);
            void this.stop();
            return;
        }

        if (code && state !== expectedState) {
            rejectCode?.(new Error("OAuth redirect state mismatch (possible CSRF attack)"));
            this.serveStaticPage(res, STATE_MISMATCH_PAGE);
            void this.stop();
            return;
        }

        // No code, no error — a stray request (favicon, double redirect).
        // Respond with a generic message without resolving/rejecting.
        this.serveStaticPage(
            res,
            `<!DOCTYPE html><html><body><p>Waiting for authorization redirect...</p></body></html>`,
        );
    }

    private serveStaticPage(
        res: {
            end(body: string): void;
            setHeader(name: string, value: string): void;
            writeHead(status: number, headers?: Record<string, string>): void;
        },
        body: string,
    ): void {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
    }

    public async stop(): Promise<void> {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        if (this.timeoutHandle) {
            window.clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
        const server = this.server;
        this.server = null;
        if (server) {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        }
    }
}

/**
 * Parses the query string from a request URL.
 *
 * The receiver only needs the query parameters (code, state, error,
 * error_description); the path is ignored. `URLSearchParams` handles
 * percent-decoding and duplicate keys (last-wins) per the URL spec.
 */
function parseQuery(url: string | undefined): URLSearchParams {
    if (!url) {
        return new URLSearchParams();
    }
    const queryIndex = url.indexOf("?");
    if (queryIndex === -1) {
        return new URLSearchParams();
    }
    return new URLSearchParams(url.slice(queryIndex + 1));
}

/**
 * Creates a production {@link DesktopOAuthReceiver} that uses Node's `http`
 * module to listen on the loopback interface.
 *
 * The receiver is desktop-only. On mobile, `start()` rejects with a clear
 * error so callers can surface a "not supported on mobile" message without
 * attempting to load the `http` module.
 *
 * @returns A {@link DesktopOAuthReceiver} backed by Node `http`.
 */
export function createDesktopOAuthReceiver(): DesktopOAuthReceiver {
    const factory = createNodeHttpServerFactory();
    return new DefaultDesktopOAuthReceiver(factory);
}

/**
 * Creates a {@link DesktopOAuthReceiver} with an injected
 * {@link HttpServerFactory}.
 *
 * Exported for tests that need to drive the request handler directly
 * without binding a real socket. Production code should use
 * {@link createDesktopOAuthReceiver}.
 *
 * @internal
 */
export function createDesktopOAuthReceiverWithFactory(factory: HttpServerFactory): DesktopOAuthReceiver {
    return new DefaultDesktopOAuthReceiver(factory);
}