/**
 * Utility functions for parsing and normalizing links and frontmatter.
 * Safe for use in both Node.js and Web Worker environments.
 */

/**
 * Normalizes a path for consistency across platforms and index lookups.
 * @param path - The raw path to normalize.
 * @returns The normalized path string.
 */
export function workerNormalizePath(path: string): string {
    if (!path) return '';
    let p = path.replace(/\\/g, '/');
    p = p.replace(/\/+/g, '/');
    p = p.replace(/^\.\//, '');
    p = p.replace(/^\/+/, '');
    p = p.replace(/\/+$/, '');
    return p;
}

/**
 * Resolves a link to a canonical path using an optional alias map.
 * @param link - The link to resolve.
 * @param aliasMap - Map of lower-case aliases to canonical paths.
 * @returns The resolved canonical path.
 */
export function resolvePath(link: string, aliasMap?: Map<string, string>): string {
    const normalizedLink = workerNormalizePath(link);

    // 1. Check alias map if provided
    if (aliasMap) {
        const aliasResolved = aliasMap.get(normalizedLink.toLowerCase());
        if (aliasResolved) return aliasResolved;
    }

    // 2. Handle potential missing .md extension
    if (!normalizedLink.endsWith('.md')) {
        // Only append .md if it doesn't look like an external URL (already handled in extractLinks but safety first)
        if (!normalizedLink.match(/^(https?|mailto):/i)) {
            return normalizedLink + '.md';
        }
    }
    return normalizedLink;
}

/**
 * Splits a markdown string into frontmatter and body.
 * @param text - The full markdown file content.
 * @returns An object containing the frontmatter string and the body string.
 */
export function splitFrontmatter(text: string): { frontmatter: string, body: string } {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*([\s\S]*)$/);
    if (match) {
        return { body: match[2] || "", frontmatter: match[1] || "" };
    }
    return { body: text, frontmatter: "" };
}

/**
 * Unified link extractor that handles both Obsidian wikilinks [[link]] 
 * and standard Markdown links [text](url).
 * @param text - The text to extract links from.
 * @returns An array of extracted link strings.
 */
export function extractLinks(text: string): string[] {
    const links: string[] = [];

    let i = 0;
    const len = text.length;

    while (i < len) {
        const char = text[i];

        // 1. Handle Escapes
        if (char === '\\') {
            i += 2;
            continue;
        }

        // 2. Handle Code (Blocks and Inline)
        if (char === '`') {
            const startBackticks = i;
            while (i < len && text[i] === '`') i++;
            const backtickCount = i - startBackticks;
            const delimiter = '`'.repeat(backtickCount);

            let searchPos = i;
            let found = false;
            while (searchPos < len) {
                const nextDelimiterPos = text.indexOf(delimiter, searchPos);
                if (nextDelimiterPos === -1) break;

                let actualCount = 0;
                let j = nextDelimiterPos;
                while (j < len && text[j] === '`') {
                    j++;
                    actualCount++;
                }

                if (actualCount === backtickCount) {
                    if (backtickCount === 1 && nextDelimiterPos > startBackticks && text[nextDelimiterPos - 1] === '\\') {
                        let backslashCount = 0;
                        let k = nextDelimiterPos - 1;
                        while (k >= startBackticks && text[k] === '\\') {
                            backslashCount++;
                            k--;
                        }
                        if (backslashCount % 2 === 1) {
                            searchPos = j;
                            continue;
                        }
                    }
                    i = j;
                    found = true;
                    break;
                } else {
                    searchPos = j;
                }
            }
            if (found) continue;
            i = startBackticks + backtickCount;
            continue;
        }

        // 3. Look for Links
        if (char === '[') {
            // Case A: Wikilinks [[ ... ]]
            if (text[i + 1] === '[') {
                const start = i + 2;
                const end = text.indexOf(']]', start);

                if (end !== -1) {
                    const rawContent = text.substring(start, end);
                    if (!rawContent.includes('\n')) {
                        const link = rawContent.split('|')[0]?.trim();
                        if (link && link.length > 0) {
                            links.push(link);
                        }
                        i = end + 2;
                        continue;
                    }
                }
            }
            // Case B: Standard Markdown Links [text](url)
            else {
                // Find potential closing bracket ]
                let bracketDepth = 1;
                let j = i + 1;
                while (j < len && bracketDepth > 0) {
                    if (text[j] === '\\') { j += 2; continue; }
                    if (text[j] === '[') bracketDepth++;
                    else if (text[j] === ']') bracketDepth--;
                    j++;
                }

                // If we found a closing bracket, check for (url)
                if (bracketDepth === 0 && text[j] === '(') {
                    const urlStart = j + 1;
                    let parenDepth = 1;
                    let k = urlStart;
                    while (k < len && parenDepth > 0) {
                        if (text[k] === '\\') { k += 2; continue; }
                        if (text[k] === '(') parenDepth++;
                        else if (text[k] === ')') parenDepth--;
                        k++;
                    }

                    if (parenDepth === 0) {
                        const rawUrl = text.substring(urlStart, k - 1).trim();

                        // Clean up the URL
                        if (rawUrl && !rawUrl.match(/^(https?|mailto):/i)) {
                            let cleanUrl = rawUrl.split('#')[0] || "";
                            cleanUrl = cleanUrl.trim();

                            if (cleanUrl.length > 0) {
                                if (cleanUrl.startsWith('/')) {
                                    cleanUrl = cleanUrl.substring(1);
                                }
                                links.push(decodeURIComponent(cleanUrl));
                            }
                        }
                        i = k;
                        continue;
                    }
                }
            }
        }

        i++;
    }

    return links;
}
