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
 * Strictly blocks local, private, and loopback addresses.
 * 
 * @param urlString The URL to validate
 * @returns true if the URL is external and non-private
 */
export function isExternalUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);

        // 1. Strict Protocol Allowlist
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return false;
        }

        const host = url.hostname.toLowerCase();

        // 2. Exact Loopback / Any Address Matches
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

        // 3. Metadata Service
        if (host === '169.254.169.254') return false;

        // 4. Private IP Ranges (IPv4)
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host);
        if (isPrivate) return false;

        // 5. Loopback Ranges (127.0.0.0/8)
        if (host.startsWith('127.')) return false;

        return true;
    } catch {
        return false;
    }
}
