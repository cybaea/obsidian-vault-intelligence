/**
 * Checks if a URL is a public HuggingFace or jsDelivr URL.
 * Used to determine if Authorization headers should be stripped.
 * Safely parses the URL to avoid substring matching vulnerabilities.
 * 
 * @param url The URL to check
 * @returns true if the URL is from a public whitelist
 */
import { URL_CONSTANTS } from "../constants";

export function isSafeUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;

        return URL_CONSTANTS.TRUSTED_DOMAINS.some(domain =>
            host === domain || host.endsWith(`.${domain}`)
        );
    } catch {
        // If the URL is invalid, it's certainly not a known public one.
        return false;
    }
}

/**
 * Validates if a URL is safe to fetch from a server-side context (SSRF protection).
 * Strictly blocks local, private, and loopback addresses by default.
 * 
 * @param urlString The URL to validate
 * @param allowLocal If true, allows access to private IP ranges and localhost
 * @returns true if the URL is external and non-private (or local access is allowed)
 */
export function isExternalUrl(urlString: string, allowLocal: boolean = false): boolean {
    try {
        const url = new URL(urlString);

        // 1. Strict Protocol Allowlist (ALWAYS BLOCKED if not http/https)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return false;
        }

        const host = url.hostname.toLowerCase();

        // 2. Cloud Metadata Service (ALWAYS BLOCKED regardless of setting)
        if (host === '169.254.169.254') return false;

        // 3. Opt-In Bypass (Power user accepts the risk for localhost/private network)
        if (allowLocal) return true;

        // 4. Default Blocklist (Runs only if allowLocal is false)

        // Exact Loopback / Any Address Matches
        const blockedHosts = [
            'localhost',
            '127.0.0.1',
            '0.0.0.0',
            '[::1]',
            '[::]',
            '::1',
            '::',
            '0:0:0:0:0:0:0:1',
            '0:0:0:0:0:0:0:0'
        ];
        if (blockedHosts.includes(host)) return false;

        // Loopback Ranges (127.0.0.0/8)
        if (host.startsWith('127.')) return false;

        // Private IP Ranges (IPv4)
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host);
        if (isPrivate) return false;

        return true;
    } catch {
        return false;
    }
}
