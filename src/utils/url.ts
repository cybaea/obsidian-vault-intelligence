/**
 * Checks if a URL is a public HuggingFace or jsDelivr URL.
 * Used to determine if Authorization headers should be stripped.
 * Safely parses the URL to avoid substring matching vulnerabilities.
 * 
 * @param url The URL to check
 * @returns true if the URL is from a public whitelist
 */
export function isPublicUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;

        return (
            host === 'huggingface.co' ||
            host.endsWith('.huggingface.co') ||
            host === 'jsdelivr.net' ||
            host.endsWith('.jsdelivr.net')
        );
    } catch {
        // If the URL is invalid, it's certainly not a known public one.
        return false;
    }
}
