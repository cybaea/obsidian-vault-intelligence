import { SEARCH_CONSTANTS, WORKER_INDEXER_CONSTANTS } from "../constants";

export function stripStopWords(query: string, currentStopWords: string[]): string {
    if (currentStopWords.length === 0) return query;
    const tokens = query.toLowerCase().split(/\s+/);
    const filtered = tokens.filter(t => !currentStopWords.includes(t));
    return filtered.length > 0 ? filtered.join(' ') : query;
}

export function computeCentroid(vectors: number[][]): number[] | undefined {
    if (vectors.length === 0) return undefined;
    const dims = vectors[0]?.length;
    if (!dims) return undefined;
    const sum: number[] = new Array<number>(dims).fill(0);
    for (const vec of vectors) {
        for (let i = 0; i < dims; i++) {
            sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0);
        }
    }
    return sum.map(v => v / vectors.length);
}

export function shuffleArray<T>(array: T[]): T[] {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j] as T, newArr[i] as T];
    }
    return newArr;
}

export function semanticSplit(text: string, maxChunkSize: number = WORKER_INDEXER_CONSTANTS.DEFAULT_MAX_CHUNK_CHARACTERS): Array<{ text: string, start: number, end: number }> {
    const chunks: Array<{ text: string, start: number, end: number }> = [];

    const pushChunk = (t: string, s: number, e: number) => {
        if (!t.trim()) return;
        if (t.length > maxChunkSize) {
            const overlap = Math.floor(maxChunkSize * 0.1);
            const subChunks = recursiveCharacterSplitter(t, maxChunkSize, overlap);

            let subOffset = 0;
            for (const sub of subChunks) {
                const searchStart = Math.max(0, subOffset - overlap - 10);
                let actualInSub = t.indexOf(sub, searchStart);
                if (actualInSub === -1) actualInSub = subOffset;

                chunks.push({
                    end: s + actualInSub + sub.length,
                    start: s + actualInSub,
                    text: sub,
                });
                subOffset = actualInSub + sub.length;
            }
        } else {
            chunks.push({ end: e, start: s, text: t });
        }
    };

    const headerRegex = /(?:^|\n)(#{1,6}\s)/g;
    const headerIndices: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = headerRegex.exec(text)) !== null) {
        const actualIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
        headerIndices.push(actualIndex);
    }

    if (headerIndices.length === 0) {
        pushChunk(text, 0, text.length);
        return chunks;
    }

    const firstHeader = headerIndices[0];
    if (firstHeader !== undefined && firstHeader > 0) {
        pushChunk(text.substring(0, firstHeader), 0, firstHeader);
    }

    let currentChunkText = "";
    let currentChunkStart = -1;

    for (let i = 0; i < headerIndices.length; i++) {
        const startIdx = headerIndices[i];
        if (startIdx === undefined) continue;
        const nextIdx = headerIndices[i + 1];
        const endIdx = nextIdx !== undefined ? nextIdx : text.length;
        const sectionText = text.substring(startIdx, endIdx);

        if (currentChunkStart === -1) currentChunkStart = startIdx;

        if (currentChunkText.length > 0 && (currentChunkText.length + sectionText.length) > maxChunkSize) {
            pushChunk(currentChunkText, currentChunkStart, currentChunkStart + currentChunkText.length);
            currentChunkText = sectionText;
            currentChunkStart = startIdx;
        } else {
            currentChunkText += sectionText;
        }
    }

    if (currentChunkText.length > 0) {
        pushChunk(currentChunkText, currentChunkStart, currentChunkStart + currentChunkText.length);
    }

    return chunks;
}

export function calculateInheritedScore(parentScore: number, linkCount: number): number {
    const dilution = Math.max(1, Math.log2(linkCount + 1));
    return parentScore * (0.8 / dilution);
}

export function estimateTokens(text: string): number {
    return text.length / SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE;
}

export function recursiveCharacterSplitter(text: string, chunkSize: number, overlap: number): string[] {
    if (text.length <= chunkSize) return [text];
    const finalChunks: string[] = [];
    let currentChunk = "";
    let parts = text.split('\n\n');
    let sep = '\n\n';

    if (parts.some(p => p.length > chunkSize)) {
        parts = text.split('\n');
        sep = '\n';
    }

    for (const part of parts) {
        if ((currentChunk.length + part.length + sep.length) > chunkSize) {
            if (currentChunk.length > 0) {
                finalChunks.push(currentChunk);
                currentChunk = currentChunk.slice(-overlap);
            }
            
            if (currentChunk.length + part.length + sep.length > chunkSize) {
                let textToSplit = currentChunk + (currentChunk.length > 0 ? sep : "") + part;
                for (let k = 0; k < textToSplit.length; k += chunkSize) {
                    finalChunks.push(textToSplit.slice(k, k + chunkSize));
                }
                currentChunk = "";
            } else {
                currentChunk += (currentChunk.length > 0 ? sep : "") + part;
            }

        } else {
            currentChunk += (currentChunk.length > 0 ? sep : "") + part;
        }
    }
    if (currentChunk.length > 0) finalChunks.push(currentChunk);
    return finalChunks;
}

export function sanitizeProperty(value: unknown): string {
    if (Array.isArray(value)) return value.map(v => sanitizeProperty(v)).join(', ');
    if (typeof value !== 'string') return String(value);
    return value.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').replace(/^["'](.+)["']$/, '$1').trim();
}

export function ensureArray(val: unknown): unknown[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
}

export function sanitizeExcalidrawContent(content: string): string {
    return content.replace(/```compressed-json[\s\S]*?```/g, '');
}

export function extractHeaders(text: string): string[] {
    return text.split('\n').filter(l => l.match(/^(#{1,3})\s+(.*)$/)).map(l => l.trim());
}

export function parseYaml(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');
    let currentKey: string | null = null;

    for (const line of lines) {
        if (line.trim() === '---' || !line.trim()) continue;
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (listMatch?.[1] && currentKey) {
            const val = listMatch[1].trim();
            const existing = result[currentKey];
            if (Array.isArray(existing)) {
                existing.push(val);
            } else {
                result[currentKey] = [val];
            }
            continue;
        }
        const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (keyMatch?.[1] && keyMatch[2] !== undefined) {
            const key = keyMatch[1];
            let value = keyMatch[2].trim();
            currentKey = key;
            if (value.startsWith('[') && value.endsWith(']')) {
                result[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else if (value) {
                result[key] = value.replace(/^['"]|['"]$/g, '');
            } else {
                result[key] = [];
            }
        }
    }
    return result;
}
