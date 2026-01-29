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
