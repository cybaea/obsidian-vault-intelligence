import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

import { requestUrl } from "obsidian";

import { isExternalUrl } from "../../../utils/url";

/**
 * Options for {@link createObsidianFetch}.
 *
 * `allowLocalNetworkAccess` mirrors the plugin-wide setting and is forwarded
 * to {@link isExternalUrl} so every outbound OAuth HTTP call (discovery, token
 * exchange, refresh, revoke) is gated by the same SSRF guard used by the
 * remote transport strategies.
 */
export interface ObsidianFetchOptions {
    readonly allowLocalNetworkAccess: boolean;
}

/**
 * Builds a {@link FetchLike} wrapper around Obsidian's `requestUrl`.
 *
 * Obsidian's `requestUrl` bypasses the browser CORS policy and handles proxy
 * configuration, which the MCP SDK's default `fetch` cannot rely on. This
 * adapter translates the SDK's standard `FetchLike` contract (`(url, init) =>
 * Promise<Response>`) onto `requestUrl` and enforces the SSRF guard
 * ({@link isExternalUrl}) on every outbound request.
 *
 * The returned `Response` preserves the HTTP status code even on error
 * statuses (4xx/5xx) because `requestUrl` is invoked with `throw: false`. The
 * SDK's auth logic inspects status codes (e.g. 401 triggers a token refresh,
 * 400 with a `WWW-Authenticate` header triggers protected-resource discovery),
 * so rejecting on HTTP error status would break the OAuth flow.
 *
 * @param options SSRF bypass configuration.
 * @returns A {@link FetchLike} function suitable for the SDK transport
 *   `fetch` option or the `auth()` `fetchFn` option.
 */
export function createObsidianFetch(options: ObsidianFetchOptions): FetchLike {
    return async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = url.toString();
        if (!isExternalUrl(urlStr, options.allowLocalNetworkAccess)) {
            throw new Error("Connection blocked by Local Network Access security settings.");
        }

        const response = await requestUrl({
            // RequestUrlParam.body is `string | ArrayBuffer`; the SDK always
            // passes a string body (URL-encoded forms, JSON). ArrayBuffer bodies
            // are cast through to satisfy the narrower Obsidian type.
            body: init?.body as string | undefined,
            headers: normalizeHeaders(init?.headers),
            method: init?.method ?? "GET",
            throw: false,
            url: urlStr,
        });

        return buildResponse(response);
    };
}

/**
 * Normalizes `RequestInit.headers` into the plain `Record<string, string>`
 * that Obsidian's `requestUrl` requires.
 *
 * `RequestInit.headers` is `HeadersInit`, which permits a `Headers` object,
 * an array of key-value pairs, or a plain record. The MCP SDK currently
 * passes plain records, but the `FetchLike` contract uses standard
 * `RequestInit`, so this adapter conforms to the full declared type rather
 * than assuming the SDK's current implementation detail.
 *
 * A plain record is passed through unchanged (preserving the original header
 * casing, which `requestUrl` accepts verbatim). `Headers` objects and tuple
 * arrays are iterated and copied into a record so a future SDK update that
 * uses either form cannot silently break OAuth calls.
 */
function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
    if (!headers) return undefined;
    if (headers instanceof Headers) {
        const normalized: Record<string, string> = {};
        headers.forEach((value, key) => { normalized[key] = value; });
        return normalized;
    }
    if (Array.isArray(headers)) {
        const normalized: Record<string, string> = {};
        for (const [key, value] of headers) {
            normalized[key] = value;
        }
        return normalized;
    }
    return headers;
}

/**
 * Constructs a standard web `Response` from an Obsidian
 * `RequestUrlResponse`.
 *
 * `RequestUrlResponse` exposes `status`, `headers`, `text`, `json`, and
 * `arrayBuffer` as eager values rather than the streaming promises of a
 * `Response`. The adapter re-exposes them through the `Response` interface
 * the SDK expects (`text()`, `json()`, `arrayBuffer()`) so consumers can use
 * the standard web API.
 *
 * `requestUrl` with `throw: false` does not reject on HTTP error statuses, so
 * the status code is preserved for the SDK's auth logic to inspect.
 */
function buildResponse(response: {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly text: string;
    readonly json: unknown;
    readonly arrayBuffer: ArrayBuffer;
}): Response {
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
        headers.set(key, value);
    }

    const init: ResponseInit = {
        headers,
        status: response.status,
    };

    // The Response body must be re-encoded to bytes because Response
    // constructors only accept Blob/BufferSource/FormData/URLSearchParams/
    // ReadableStream/Uint8Array/string. Obsidian's `text` is a decoded
    // string; `arrayBuffer` is the original bytes. Prefer the original
    // bytes so the body round-trips byte-for-byte (important for binary
    // responses and non-UTF8 encodings).
    return new Response(response.arrayBuffer, init);
}