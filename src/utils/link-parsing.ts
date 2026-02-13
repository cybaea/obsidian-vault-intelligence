/**
 * Utility functions for parsing and normalizing links and frontmatter.
 * Safe for use in both Node.js and Web Worker environments.
 */

/**
 * Fast 32-bit hash (DJB2) for use as a content anchor.
 * @param text - The text to hash (only first 4096 characters used for performance).
 * @returns A 32-bit unsigned integer.
 */
export function fastHash(text: string): number {
    let hash = 5381;
    for (let i = 0; i < Math.min(text.length, 4096); i++) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return hash >>> 0;
}


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
 * Resolves a link to a canonical path using an optional alias map and base path.
 * @param link - The link to resolve.
 * @param aliasMap - Map of lower-case aliases to canonical paths.
 * @param basePath - Optional base path (directory of the file containing the link) for relative resolution.
 * @returns The resolved canonical path.
 */
export function resolvePath(link: string, aliasMap?: Map<string, string>, basePath?: string): string {
    let normalizedLink = workerNormalizePath(link);

    // 1. Handle Relative Paths (./ or ../)
    if (basePath && (normalizedLink.startsWith('./') || normalizedLink.startsWith('../'))) {
        const segments = basePath.split('/').filter(s => s.length > 0);
        const linkSegments = normalizedLink.split('/');

        for (const segment of linkSegments) {
            if (segment === '.') continue;
            if (segment === '..') {
                segments.pop();
            } else {
                segments.push(segment);
            }
        }
        normalizedLink = segments.join('/');
    }

    // 2. Check alias map if provided
    if (aliasMap) {
        const aliasResolved = aliasMap.get(normalizedLink.toLowerCase());
        if (aliasResolved) return aliasResolved;
    }

    // 3. Handle potential missing .md extension for internal notes
    if (!normalizedLink.includes('.') && !normalizedLink.startsWith('#')) {
        // Only append .md if it has no extension and doesn't look like an external URL or tag
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
export function splitFrontmatter(text: string): { frontmatter: string, body: string, bodyOffset: number } {
    if (!text.startsWith("---")) {
        return { body: text, bodyOffset: 0, frontmatter: "" };
    }

    const firstLineEnd = text.indexOf("\n");
    if (firstLineEnd === -1) return { body: text, bodyOffset: 0, frontmatter: "" };

    const secondSeparator = text.indexOf("\n---", firstLineEnd);
    if (secondSeparator === -1) return { body: text, bodyOffset: 0, frontmatter: "" };

    // Find the end of the second separator line
    let bodyStart = secondSeparator + 4; // Length of "\n---"
    while (bodyStart < text.length && (text[bodyStart] === "-" || text[bodyStart] === " " || text[bodyStart] === "\r" || text[bodyStart] === "\t")) {
        bodyStart++;
    }
    if (bodyStart < text.length && text[bodyStart] === "\n") {
        bodyStart++;
    }

    return {
        body: text.substring(bodyStart),
        bodyOffset: bodyStart,
        frontmatter: text.substring(0, bodyStart).trim()
    };
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

/**
 * Strips Excalidraw compressed JSON blocks from content.
 * @param content - The raw file content.
 * @returns The content with the compressed JSON block removed.
 */
export function sanitizeExcalidrawContent(content: string): string {
    return content.replace(/```compressed-json[\s\S]*?```/g, (match) => " ".repeat(match.length));
}

