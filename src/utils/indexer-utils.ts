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

const MAX_FENCE_INDENT_SPACES = 3;
const MIN_FENCE_MARKER_LENGTH = 3;
const BACKTICK_MARKER = '`';
const TILDE_MARKER = '~';

/**
 * Half-open character span in the text it was derived from; end is exclusive.
 */
export interface FenceInterval {
    end: number;
    start: number;
}

/**
 * Detects fenced code blocks (backtick and tilde fences) and returns their exact
 * character spans. Detection follows pragmatic CommonMark rules: marker runs of at
 * least three characters after at most three leading spaces, closing fences of the
 * same marker character that are at least as long as the opening fence, and info
 * strings that exclude backticks for backtick fences. An unclosed fence spans to
 * the end of the text, mirroring rendered output where everything after it is code
 * content. Offsets are exact so callers can slice the original text without drift,
 * including CRLF-terminated documents.
 */
export function findCodeFenceIntervals(text: string): FenceInterval[] {
    const intervals: FenceInterval[] = [];
    const len = text.length;
    let lineStart = 0;
    let isOpen = false;
    let openMarkerChar = BACKTICK_MARKER;
    let openMarkerLength = 0;
    let openStart = -1;

    while (lineStart <= len) {
        const newlineIndex = text.indexOf('\n', lineStart);
        const lineEnd = newlineIndex === -1 ? len : newlineIndex;

        let indent = 0;
        while (indent <= MAX_FENCE_INDENT_SPACES && text.charAt(lineStart + indent) === ' ') indent++;

        if (indent <= MAX_FENCE_INDENT_SPACES) {
            const contentEnd = text.endsWith('\r', lineEnd) ? lineEnd - 1 : lineEnd;
            const markerStart = lineStart + indent;
            const firstChar = text.charAt(markerStart);

            if (isOpen) {
                if (firstChar === openMarkerChar && closesFence(text.substring(markerStart, contentEnd), openMarkerChar, openMarkerLength)) {
                    intervals.push({ end: newlineIndex === -1 ? len : newlineIndex + 1, start: openStart });
                    isOpen = false;
                    openStart = -1;
                }
            } else if (firstChar === BACKTICK_MARKER || firstChar === TILDE_MARKER) {
                const opener = parseFenceOpener(text.substring(markerStart, contentEnd));
                if (opener !== null) {
                    isOpen = true;
                    openMarkerChar = opener.markerChar;
                    openMarkerLength = opener.markerLength;
                    openStart = markerStart;
                }
            }
        }

        if (newlineIndex === -1) break;
        lineStart = newlineIndex + 1;
    }

    if (isOpen) {
        intervals.push({ end: len, start: openStart });
    }

    return intervals;
}

/**
 * Parses a fence opener line content such as "```python" and returns the marker
 * details, or null when the line does not open a code fence.
 */
function parseFenceOpener(content: string): { markerChar: string, markerLength: number } | null {
    const firstChar = content.charAt(0);
    if (firstChar !== BACKTICK_MARKER && firstChar !== TILDE_MARKER) return null;

    let markerLength = 0;
    while (markerLength < content.length && content.charAt(markerLength) === firstChar) markerLength++;
    if (markerLength < MIN_FENCE_MARKER_LENGTH) return null;

    const info = content.slice(markerLength);
    // CommonMark: the info string of a backtick fence may not contain backticks.
    if (firstChar === BACKTICK_MARKER && info.includes(BACKTICK_MARKER)) return null;

    return { markerChar: firstChar, markerLength };
}

/**
 * Checks whether a line content closes a fence opened with the given marker.
 */
function closesFence(content: string, markerChar: string, minMarkerLength: number): boolean {
    let markerLength = 0;
    while (markerLength < content.length && content.charAt(markerLength) === markerChar) markerLength++;
    if (markerLength < minMarkerLength) return false;

    return /^[ \t]*$/.test(content.slice(markerLength));
}

/**
 * Drops header candidates that fall inside fenced code spans. Both inputs are
 * ascending, so a single linear merge pass suffices and no text is mutated.
 */
function filterHeadersOutsideFences(headerIndices: number[], intervals: FenceInterval[]): number[] {
    if (intervals.length === 0) return headerIndices;

    const kept: number[] = [];
    let intervalIndex = 0;

    for (const headerIndex of headerIndices) {
        let interval = intervals[intervalIndex];
        while (interval !== undefined && interval.end <= headerIndex) {
            intervalIndex++;
            interval = intervals[intervalIndex];
        }
        if (interval === undefined || headerIndex < interval.start) {
            kept.push(headerIndex);
        }
    }

    return kept;
}

/**
 * Synthetic fence lines required to render a chunk excerpt as a self-balanced
 * code block: prefix opens the fence the chunk begins inside, suffix closes
 * the fence the chunk ends inside. Empty strings mean nothing is required.
 */
export interface FenceAugmentation {
    prefix: string;
    suffix: string;
}

/**
 * A semanticSplit chunk. Offsets always address the raw source text, while
 * text can carry the synthetic fence lines recorded by fenceAugmented.
 */
export interface SemanticChunk {
    end: number;
    fenceAugmented: boolean;
    start: number;
    text: string;
}

/**
 * Counts the fence marker characters starting at position; zero when the
 * position does not start a backtick or tilde run.
 */
function markerRunLength(text: string, position: number): number {
    const markerChar = text.charAt(position);
    if (markerChar !== BACKTICK_MARKER && markerChar !== TILDE_MARKER) return 0;

    let length = 0;
    while (position + length < text.length && text.charAt(position + length) === markerChar) length++;
    return length;
}

/**
 * Returns the language token (first whitespace-delimited token of the info
 * string) of the fence opener whose first marker character sits at markerStart.
 */
function fenceLanguage(text: string, markerStart: number): string {
    let lineEnd = text.indexOf('\n', markerStart);
    if (lineEnd === -1) lineEnd = text.length;

    const info = text.substring(markerStart + markerRunLength(text, markerStart), lineEnd).trim();
    const firstSeparator = info.search(/\s/);
    return firstSeparator === -1 ? info : info.slice(0, firstSeparator);
}

/**
 * Locates the closer candidate of a fence interval: the last line after the
 * opener line, which is the only place a closer can live (any line matching
 * the closer criteria closes the fence during the scan, so an unclosed
 * interval cannot contain one). Returns null when the interval holds no line
 * after the opener; start may exceed end for an empty final line.
 */
interface FenceCloserSpan {
    end: number;
    start: number;
}

function fenceCloserSpan(text: string, interval: FenceInterval): FenceCloserSpan | null {
    const openerNewline = text.indexOf('\n', interval.start);
    if (openerNewline === -1 || openerNewline >= interval.end) return null;

    let lineStart: number;
    let lineEnd: number;
    if (text.charAt(interval.end - 1) === '\n') {
        lineStart = Math.max(text.lastIndexOf('\n', interval.end - 2) + 1, openerNewline + 1);
        lineEnd = interval.end - 1;
    } else {
        lineStart = Math.max(text.lastIndexOf('\n', interval.end - 1) + 1, openerNewline + 1);
        lineEnd = interval.end;
    }

    return { end: lineEnd, start: lineStart };
}

/**
 * The interval's closer candidate with its carriage return stripped, or an
 * empty string when there is no line after the opener.
 */
function fenceCloserLine(text: string, interval: FenceInterval): string {
    const span = fenceCloserSpan(text, interval);
    if (span === null) return '';

    const line = text.substring(span.start, span.end);
    return line.endsWith('\r') ? line.substring(0, line.length - 1) : line;
}

/**
 * Reports whether the fence interval was never closed. Sound by scanner
 * construction: any line matching the closer criteria closes the fence during
 * the scan, so only an interval whose final line is not a closer (or which has
 * no line after the opener at all) can reach end of text open. Like the
 * scanner, up to three leading spaces of indent are stripped from the closer
 * line before its content is parsed.
 */
function isUnclosedFence(text: string, interval: FenceInterval): boolean {
    const closerLine = fenceCloserLine(text, interval);
    if (closerLine === '') return true;

    let indent = 0;
    while (indent <= MAX_FENCE_INDENT_SPACES && closerLine.charAt(indent) === ' ') indent++;
    if (indent > MAX_FENCE_INDENT_SPACES) return true;

    return !closesFence(closerLine.slice(indent), text.charAt(interval.start), markerRunLength(text, interval.start));
}

/**
 * Index just past the closer's marker run of a closed interval, or the
 * interval end when it is unclosed. Trailing whitespace and the line break
 * belong to the line, not to the balancing markers: a chunk cut any time
 * after the markers already carries a complete closer.
 */
function closerMarkerEnd(text: string, interval: FenceInterval): number {
    const span = fenceCloserSpan(text, interval);
    if (span === null || isUnclosedFence(text, interval)) return interval.end;

    let indent = 0;
    const closerLine = fenceCloserLine(text, interval);
    while (indent <= MAX_FENCE_INDENT_SPACES && closerLine.charAt(indent) === ' ') indent++;

    const content = closerLine.slice(indent);
    const markerChar = text.charAt(interval.start);
    let run = 0;
    while (run < content.length && content.charAt(run) === markerChar) run++;

    return span.start + indent + run;
}

/**
 * Decides which synthetic fence lines a chunk span [start, end) of text needs
 * to render as a self-balanced code block. Offsets must address the same text
 * the intervals were derived from; intervals may be passed in when the caller
 * has already scanned text, which keeps oversized sections linear.
 *
 * The excerpt stands alone, so a fence it opens must close inside it: a
 * synthetic opener either pairs with the fence's real closer line (when that
 * line is fully present) or receives a matching suffix, and a real opener line
 * inside the excerpt (with its closer beyond the cut) receives a matching
 * suffix. Marker remnants shorter than a legal fence never open one.
 */
export function getFenceAugmentation(text: string, start: number, end: number, intervals?: FenceInterval[]): FenceAugmentation {
    const augmentation: FenceAugmentation = { prefix: '', suffix: '' };
    const fenceIntervals = intervals ?? findCodeFenceIntervals(text);
    if (fenceIntervals.length === 0) return augmentation;

    for (const interval of fenceIntervals) {
        if (interval.end <= start) continue;
        if (interval.start >= end) break;

        const closed = !isUnclosedFence(text, interval);
        // Index past the closer's marker run: trailing whitespace and the line
        // break belong to the interval, not to the balancing markers, so a
        // chunk cut any time after the markers already holds a complete
        // closer. For unclosed intervals the markers never end inside the
        // text, so only the synthetic suffix can close the excerpt.
        const closerEndIndex = closerMarkerEnd(text, interval);
        const closerFullyInside = closed && end >= closerEndIndex;
        const marker = text.charAt(interval.start).repeat(markerRunLength(text, interval.start));
        const separator = text.charAt(end - 1) === '\n' ? '' : '\n';

        if (interval.start < start) {
            // The excerpt begins strictly inside the fence, so the opener line
            // is missing; resynthesise it with the fence's own marker and
            // language. A real closer line that is fully present later in the
            // excerpt closes the synthetic opener, so no suffix is needed.
            augmentation.prefix = `${marker}${fenceLanguage(text, interval.start)}\n`;
            if (closerFullyInside) continue;
            augmentation.suffix = `${separator}${marker}\n`;
            break;
        }

        // The opener line lies inside the excerpt: the fence it opens must
        // close within the excerpt. A too-short marker remnant does not open
        // a fence and stays untouched.
        const openerPresent = end >= interval.start + MIN_FENCE_MARKER_LENGTH;
        if (openerPresent && !closerFullyInside) {
            augmentation.suffix = `${separator}${marker}\n`;
            break;
        }
    }

    return augmentation;
}

/**
 * Wraps a chunk text with the synthetic fence lines from getFenceAugmentation.
 * The prefix always terminates with a newline and the suffix starts and ends
 * with newlines, so plain concatenation keeps every marker at line start.
 */
export function applyFenceAugmentation(text: string, augmentation: FenceAugmentation): string {
    return `${augmentation.prefix}${text}${augmentation.suffix}`;
}

export function semanticSplit(text: string, maxChunkSize: number = WORKER_INDEXER_CONSTANTS.DEFAULT_MAX_CHUNK_CHARACTERS): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];

    const pushChunk = (t: string, s: number, e: number) => {
        if (!t.trim()) return;
        if (t.length > maxChunkSize) {
            const overlap = Math.floor(maxChunkSize * 0.1);
            const sectionIntervals = findCodeFenceIntervals(t);
            for (const sub of splitWithOffsets(t, maxChunkSize, overlap)) {
                if (sub.end <= sub.start) continue;

                const augmentation = getFenceAugmentation(t, sub.start, sub.end, sectionIntervals);
                chunks.push({
                    end: s + sub.end,
                    fenceAugmented: augmentation.prefix !== '' || augmentation.suffix !== '',
                    start: s + sub.start,
                    text: applyFenceAugmentation(t.slice(sub.start, sub.end), augmentation),
                });
            }
        } else {
            // The chunk equals t itself, so fence state is evaluated over the
            // chunk text: a fitting closed fence stays untouched, while an
            // unclosed fence that fits whole still needs its closing line.
            const augmentation = getFenceAugmentation(t, 0, t.length);
            chunks.push({
                end: e,
                fenceAugmented: augmentation.prefix !== '' || augmentation.suffix !== '',
                start: s,
                text: applyFenceAugmentation(t, augmentation),
            });
        }
    };

    const headerRegex = /(?:^|\n)(#{1,6}\s)/g;
    const headerIndices: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = headerRegex.exec(text)) !== null) {
        const actualIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
        headerIndices.push(actualIndex);
    }

    // Header candidates inside fenced code (for example "# comment" lines in
    // Python or shell blocks) are not structural boundaries.
    const structuralHeaders = filterHeadersOutsideFences(headerIndices, findCodeFenceIntervals(text));

    if (structuralHeaders.length === 0) {
        pushChunk(text, 0, text.length);
        return chunks;
    }

    const firstHeader = structuralHeaders[0];
    if (firstHeader !== undefined && firstHeader > 0) {
        pushChunk(text.substring(0, firstHeader), 0, firstHeader);
    }

    let currentChunkText = "";
    let currentChunkStart = -1;

    for (let i = 0; i < structuralHeaders.length; i++) {
        const startIdx = structuralHeaders[i];
        if (startIdx === undefined) continue;
        const nextIdx = structuralHeaders[i + 1];
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

export function estimateTokens(text: string, charsPerToken: number = SEARCH_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE): number {
    return text.length / charsPerToken;
}

/**
 * A chunk span carrying its exact text fragment.
 */
export interface TextSpan extends FenceInterval {
    text: string;
}

/**
 * Fence-aware splitter. Returns chunks as exact text slices paired with their
 * half-open [start, end) character offsets in the input, so callers can keep
 * offset-based features (hydration anchors, highlighting) in sync.
 */
export function splitWithOffsets(text: string, chunkSize: number, overlap: number): TextSpan[] {
    if (text.length <= chunkSize) {
        return [{ end: text.length, start: 0, text }];
    }

    const fenceIntervals = findCodeFenceIntervals(text);
    const ranges = fenceIntervals.length === 0
        ? legacyAccumulatedSpans(text, chunkSize, overlap)
        : fenceAwareSpans(text, chunkSize, overlap, fenceIntervals);

    return ranges.map((range) => ({ end: range.end, start: range.start, text: text.slice(range.start, range.end) }));
}

/**
 * Compatibility wrapper returning chunk texts only.
 */
export function recursiveCharacterSplitter(text: string, chunkSize: number, overlap: number): string[] {
    return splitWithOffsets(text, chunkSize, overlap).map((span) => span.text);
}

/**
 * Historic splitter behaviour (paragraph split, optional line split, carry
 * overlap, hard slice for oversized single lines) ported to index arithmetic
 * so fenceless documents produce byte-identical output to the previous
 * implementation. Every emitted range is a literal slice of the input.
 */
function legacyAccumulatedSpans(text: string, chunkSize: number, overlap: number): FenceInterval[] {
    let spans = separateSpans(text, 0, text.length, '\n\n', []);
    if (spans.some((span) => span.end - span.start > chunkSize)) {
        spans = separateSpans(text, 0, text.length, '\n', []);
    }

    return accumulateSpans(spans, chunkSize, overlap);
}

/**
 * Fence-aware tier for documents that contain code fences. Fences that fit
 * within chunkSize stay atomic; oversized fences become line-splittable so
 * their interior can still be chunked. Oversized segments without line
 * boundaries fall back to hard slicing, as before.
 */
function fenceAwareSpans(text: string, chunkSize: number, overlap: number, fenceIntervals: FenceInterval[]): FenceInterval[] {
    const paragraphSpans = separateSpans(text, 0, text.length, '\n\n', fenceIntervals);
    const atomicSpans: FenceInterval[] = [];
    const fittingFences = fenceIntervals.filter((fence) => fence.end - fence.start <= chunkSize);

    for (const part of paragraphSpans) {
        if (part.end - part.start <= chunkSize) {
            atomicSpans.push(part);
            continue;
        }

        const lineSpans = separateSpans(text, part.start, part.end, '\n', fittingFences);
        for (const segment of lineSpans) {
            if (segment.end - segment.start <= chunkSize) {
                atomicSpans.push(segment);
                continue;
            }
            // An oversized segment can still hold a fitting fence when plain text
            // hugs the fence without a blank line between them; split at the fence
            // edges so the fence stays whole, then handle the remaining pieces.
            for (const piece of splitSpanAtFences(segment, fittingFences)) {
                if (piece.end - piece.start <= chunkSize) {
                    atomicSpans.push(piece);
                } else {
                    hardSliceSpans(atomicSpans, piece, chunkSize);
                }
            }
        }
    }

    return accumulateSpans(atomicSpans, chunkSize, overlap, fittingFences);
}

/**
 * Cuts a span at fitting-fence edges so each fence becomes its own atomic span
 * while the surrounding text becomes separate pieces.
 */
function splitSpanAtFences(segment: FenceInterval, fences: FenceInterval[]): FenceInterval[] {
    const pieces: FenceInterval[] = [];
    let cursor = segment.start;

    for (const fence of fences) {
        if (fence.start < cursor || fence.end > segment.end) continue;
        if (fence.start > cursor) pieces.push({ end: fence.start, start: cursor });
        pieces.push({ end: fence.end, start: fence.start });
        cursor = fence.end;
    }

    if (cursor < segment.end) pieces.push({ end: segment.end, start: cursor });

    return pieces;
}

/**
 * Splits [from, to) at separator occurrences that sit outside the given fence
 * intervals. Fence interiors stay single spans, which is what keeps a fitting
 * code fence whole.
 */
function separateSpans(text: string, from: number, to: number, separator: string, intervals: FenceInterval[]): FenceInterval[] {
    const spans: FenceInterval[] = [];
    let cursor = from;

    while (cursor <= to) {
        const found = indexOfOutsideFences(text, separator, cursor, to, intervals);
        if (found === -1) {
            spans.push({ end: to, start: cursor });
            break;
        }
        spans.push({ end: found, start: cursor });
        cursor = found + separator.length;
    }

    return spans;
}

/**
 * Finds the next separator occurrence within [searchFrom, to) that does not
 * overlap a fence interval; touching a fence edge is allowed.
 */
function indexOfOutsideFences(text: string, separator: string, searchFrom: number, to: number, intervals: FenceInterval[]): number {
    let cursor = searchFrom;

    for (;;) {
        const found = text.indexOf(separator, cursor);
        if (found === -1 || found + separator.length > to) return -1;

        let insideFence = false;
        for (const fence of intervals) {
            if (found < fence.end && found + separator.length > fence.start) {
                insideFence = true;
                break;
            }
            if (fence.start >= found + separator.length) break;
        }

        if (!insideFence) return found;
        cursor = found + 1;
    }
}

/**
 * Folds adjacent spans into chunks of at most chunkSize characters,
 * reproducing the historic accumulation semantics including the carry overlap
 * between consecutive chunks. Spans are adjacent, so every folded range stays
 * a literal slice of the original text. When an overflowing span holds a
 * fitting fence, the carry is dropped at the fence edge instead of hard
 * slicing through the code block.
 */
function accumulateSpans(spans: FenceInterval[], chunkSize: number, overlap: number, atomicIntervals: FenceInterval[] = []): FenceInterval[] {
    const chunks: FenceInterval[] = [];
    let chunkStart = -1;
    let chunkEnd = 0;
    let prevSpanEnd: number | null = null;

    for (const span of spans) {
        const spanLength = span.end - span.start;
        const gap = prevSpanEnd === null ? 0 : span.start - prevSpanEnd;
        prevSpanEnd = span.end;
        const currentLength = chunkStart === -1 ? 0 : chunkEnd - chunkStart;

        if (currentLength + spanLength + gap <= chunkSize) {
            if (chunkStart === -1) chunkStart = span.start;
            chunkEnd = span.end;
            if (chunkEnd === chunkStart) chunkStart = -1;
            continue;
        }

        const spanHoldsFence = atomicIntervals.some((interval) => interval.start >= span.start && interval.end <= span.end);

        if (chunkStart !== -1) {
            if (spanHoldsFence) {
                // Keep the buffered carry, extended through the separator up to
                // the fence edge, and give the fence chunk of its own.
                chunks.push({ end: span.start, start: chunkStart });
                chunks.push({ end: span.end, start: span.start });
                chunkStart = -1;
                continue;
            }
            chunks.push({ end: chunkEnd, start: chunkStart });
            // Mirrors the historic slice(-overlap) carry; slice(-0) kept the
            // whole chunk, so zero overlap carries everything.
            const carryLength = overlap === 0 ? currentLength : Math.min(overlap, currentLength);
            chunkStart = chunkEnd - carryLength;
        }

        const carriedLength = chunkStart === -1 ? 0 : chunkEnd - chunkStart;
        if (carriedLength + spanLength + gap > chunkSize) {
            if (spanHoldsFence) {
                // Empty buffer: give the fence its own chunk. A separator-sized
                // coverage gap is acceptable; slices stay byte-exact.
                chunks.push({ end: span.end, start: span.start });
                chunkStart = -1;
            } else {
                const sliceStart = chunkStart === -1 ? span.start : chunkStart;
                hardSliceSpans(chunks, { end: span.end, start: sliceStart }, chunkSize);
                chunkStart = -1;
            }
        } else {
            if (chunkStart === -1) chunkStart = span.start;
            chunkEnd = span.end;
            if (chunkEnd === chunkStart) chunkStart = -1;
        }
    }

    if (chunkStart !== -1 && chunkEnd > chunkStart) {
        chunks.push({ end: chunkEnd, start: chunkStart });
    }

    return chunks;
}

/**
 * Hard-slices a segment into chunkSize-sized literal ranges; last resort for
 * oversized single lines with no split candidates.
 */
function hardSliceSpans(target: FenceInterval[], segment: FenceInterval, chunkSize: number): void {
    for (let offset = segment.start; offset < segment.end; offset += chunkSize) {
        const sliceEnd = Math.min(offset + chunkSize, segment.end);
        if (sliceEnd > offset) target.push({ end: sliceEnd, start: offset });
    }
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
