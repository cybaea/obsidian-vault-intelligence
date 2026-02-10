/**
 * List of language codes that typically have high information density per character
 * and benefit from smaller vector chunk sizes (e.g. 512 instead of 1024).
 */
export const COMPLEX_LANGUAGE_CODES = ['zh', 'ja', 'ko', 'ar', 'hi', 'th', 'he'];

/**
 * Determines if a language string (name or code) represents a complex script.
 */
export function isComplexLanguage(language: string | undefined | null): boolean {
    if (!language) return false;
    const lower = language.toLowerCase();
    return COMPLEX_LANGUAGE_CODES.some(code => lower.startsWith(code));
}
