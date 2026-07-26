import { requestUrl } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createObsidianFetch } from '../../../../src/services/mcp/oauth/ObsidianFetchAdapter';

// Mock obsidian's requestUrl so no real network calls occur. The mock is
// typed as `any` per the test-level relief in eslint.config.mts.
vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
}));

interface RequestUrlResponseMock {
    arrayBuffer: ArrayBuffer;
    headers: Record<string, string>;
    json: unknown;
    status: number;
    text: string;
}

function makeResponse(overrides: Partial<RequestUrlResponseMock> = {}): RequestUrlResponseMock {
    return {
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
        json: {},
        status: 200,
        text: '',
        ...overrides,
    };
}

function encodeText(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer;
}

describe('ObsidianFetchAdapter', () => {
    let fetchFn: ReturnType<typeof createObsidianFetch>;
    let requestUrlMock: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        requestUrlMock = requestUrl as unknown as Mock;
        fetchFn = createObsidianFetch({ allowLocalNetworkAccess: false });
    });

    describe('SSRF guard', () => {
        it('allows external HTTPS URLs', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({ status: 200 }));

            const response = await fetchFn('https://accounts.example.com/token');

            expect(response.status).toBe(200);
            expect(requestUrlMock).toHaveBeenCalledTimes(1);
            const callArg = requestUrlMock.mock.calls[0]?.[0] as { url: string };
            expect(callArg?.url).toBe('https://accounts.example.com/token');
        });

        it('blocks loopback addresses (127.0.0.1) when allowLocalNetworkAccess is false', async () => {
            await expect(fetchFn('http://127.0.0.1:8080/callback'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });

        it('blocks localhost when allowLocalNetworkAccess is false', async () => {
            await expect(fetchFn('http://localhost:8080/callback'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });

        it('blocks the cloud metadata service (169.254.169.254)', async () => {
            await expect(fetchFn('http://169.254.169.254/latest/meta-data/'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });

        it('blocks private IP ranges (192.168.x.x) when allowLocalNetworkAccess is false', async () => {
            await expect(fetchFn('https://192.168.1.1/admin'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });

        it('allows loopback addresses when allowLocalNetworkAccess is true', async () => {
            const localFetch = createObsidianFetch({ allowLocalNetworkAccess: true });
            requestUrlMock.mockResolvedValue(makeResponse({ status: 200 }));

            const response = await localFetch('http://127.0.0.1:8080/callback');

            expect(response.status).toBe(200);
            expect(requestUrlMock).toHaveBeenCalledTimes(1);
        });

        it('still blocks the cloud metadata service even when allowLocalNetworkAccess is true', async () => {
            const localFetch = createObsidianFetch({ allowLocalNetworkAccess: true });
            await expect(localFetch('http://169.254.169.254/latest/meta-data/'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });

        it('blocks non-http(s) protocols regardless of allowLocalNetworkAccess', async () => {
            await expect(fetchFn('file:///etc/passwd'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            const localFetch = createObsidianFetch({ allowLocalNetworkAccess: true });
            await expect(localFetch('ftp://example.com/file'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
            expect(requestUrlMock).not.toHaveBeenCalled();
        });
    });

    describe('request construction', () => {
        it('defaults method to GET', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn('https://example.com/');

            const callArg = requestUrlMock.mock.calls[0]?.[0] as { method: string };
            expect(callArg?.method).toBe('GET');
        });

        it('forwards method, headers, and body from RequestInit', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn('https://example.com/token', {
                body: 'grant_type=authorization_code',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                method: 'POST',
            });

            const callArg = requestUrlMock.mock.calls[0]?.[0] as {
                body: string;
                headers: Record<string, string>;
                method: string;
                throw: boolean;
            };
            expect(callArg?.method).toBe('POST');
            expect(callArg?.body).toBe('grant_type=authorization_code');
            expect(callArg?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
        });

        it('normalizes a Headers object into a plain record', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn('https://example.com/token', {
                headers: new Headers({ 'Content-Type': 'application/json', 'X-Custom': 'value' }),
                method: 'POST',
            });

            const callArg = requestUrlMock.mock.calls[0]?.[0] as {
                headers: Record<string, string>;
            };
            // Headers objects store names lowercased per the Fetch spec; the
            // adapter preserves that casing rather than re-uppercasing.
            expect(callArg?.headers).toEqual({
                'content-type': 'application/json',
                'x-custom': 'value',
            });
        });

        it('normalizes a tuple-array HeadersInit into a plain record', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn('https://example.com/token', {
                headers: [['Content-Type', 'text/plain'], ['X-Trace', 'abc']],
                method: 'POST',
            });

            const callArg = requestUrlMock.mock.calls[0]?.[0] as {
                headers: Record<string, string>;
            };
            expect(callArg?.headers).toEqual({
                'Content-Type': 'text/plain',
                'X-Trace': 'abc',
            });
        });

        it('passes undefined headers through when no RequestInit is given', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn('https://example.com/');

            const callArg = requestUrlMock.mock.calls[0]?.[0] as {
                headers: Record<string, string> | undefined;
            };
            expect(callArg?.headers).toBeUndefined();
        });

        it('always passes throw: false so error statuses are preserved', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({ status: 401 }));

            await fetchFn('https://example.com/');

            const callArg = requestUrlMock.mock.calls[0]?.[0] as { throw: boolean };
            expect(callArg?.throw).toBe(false);
        });

        it('accepts a URL object as well as a string', async () => {
            requestUrlMock.mockResolvedValue(makeResponse());

            await fetchFn(new URL('https://example.com/path'));

            const callArg = requestUrlMock.mock.calls[0]?.[0] as { url: string };
            expect(callArg?.url).toBe('https://example.com/path');
        });
    });

    describe('status mapping', () => {
        it('maps a 200 response with ok true', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({ status: 200 }));

            const response = await fetchFn('https://example.com/');

            expect(response.status).toBe(200);
            expect(response.ok).toBe(true);
        });

        it('maps a 401 response with ok false', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({ status: 401 }));

            const response = await fetchFn('https://example.com/');

            expect(response.status).toBe(401);
            expect(response.ok).toBe(false);
        });

        it('maps a 500 response with ok false', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({ status: 500 }));

            const response = await fetchFn('https://example.com/');

            expect(response.status).toBe(500);
            expect(response.ok).toBe(false);
        });
    });

    describe('body parsing', () => {
        it('exposes text via text()', async () => {
            const body = 'hello world';
            requestUrlMock.mockResolvedValue(makeResponse({
                arrayBuffer: encodeText(body),
                text: body,
            }));

            const response = await fetchFn('https://example.com/');

            expect(await response.text()).toBe(body);
        });

        it('exposes JSON via json()', async () => {
            const jsonBody = JSON.stringify({ access_token: 'abc', token_type: 'Bearer' });
            requestUrlMock.mockResolvedValue(makeResponse({
                arrayBuffer: encodeText(jsonBody),
                json: { access_token: 'abc', token_type: 'Bearer' },
                text: jsonBody,
            }));

            const response = await fetchFn('https://example.com/token');

            expect(await response.json()).toEqual({ access_token: 'abc', token_type: 'Bearer' });
        });

        it('exposes bytes via arrayBuffer()', async () => {
            const bytes = new Uint8Array([0, 1, 2, 3, 4]);
            requestUrlMock.mockResolvedValue(makeResponse({
                arrayBuffer: bytes.buffer,
            }));

            const response = await fetchFn('https://example.com/binary');

            const result = new Uint8Array(await response.arrayBuffer());
            expect(Array.from(result)).toEqual([0, 1, 2, 3, 4]);
        });

        it('round-trips non-ASCII text byte-for-byte', async () => {
            const body = 'héllo wörld 日本語';
            requestUrlMock.mockResolvedValue(makeResponse({
                arrayBuffer: encodeText(body),
                text: body,
            }));

            const response = await fetchFn('https://example.com/');

            expect(await response.text()).toBe(body);
        });
    });

    describe('headers', () => {
        it('maps response headers to a Headers object', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({
                headers: {
                    'Content-Type': 'application/json',
                    'WWW-Authenticate': 'Bearer realm="example"',
                },
            }));

            const response = await fetchFn('https://example.com/');

            expect(response.headers.get('content-type')).toBe('application/json');
            expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="example"');
        });
    });

    describe('error handling', () => {
        it('surfaces the SSRF block message on a blocked URL', async () => {
            await expect(fetchFn('http://localhost:1/'))
                .rejects.toThrow('Connection blocked by Local Network Access security settings.');
        });

        it('preserves error statuses without rejecting (SDK inspects 401)', async () => {
            requestUrlMock.mockResolvedValue(makeResponse({
                headers: { 'WWW-Authenticate': 'Bearer realm="example"' },
                status: 401,
            }));

            const response = await fetchFn('https://example.com/');

            expect(response.status).toBe(401);
            expect(response.ok).toBe(false);
            expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="example"');
        });

        it('propagates requestUrl network errors', async () => {
            requestUrlMock.mockRejectedValue(new Error('network down'));

            await expect(fetchFn('https://example.com/')).rejects.toThrow('network down');
        });
    });
});