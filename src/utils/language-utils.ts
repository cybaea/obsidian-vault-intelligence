/**
 * Languages explicitly supported by the Orama engine for tokenization/stemming.
 * Unsupported languages (like Chinese/Japanese/Hindi) must map to 'english'
 * for the engine constructor to prevent crashes.
 */
export type OramaEngineLanguage =
    | 'arabic' | 'armenian' | 'bulgarian' | 'danish' | 'dutch'
    | 'english' | 'finnish' | 'french' | 'german' | 'greek'
    | 'hungarian' | 'indonesian' | 'irish' | 'italian' | 'nepali'
    | 'norwegian' | 'portuguese' | 'romanian' | 'russian' | 'slovenian'
    | 'spanish' | 'swedish' | 'turkish' | 'ukrainian';

/**
 * Stopword keys matching @orama/stopwords package exports.
 */
export type OramaStopwordKey =
    | OramaEngineLanguage
    | 'mandarin' // For Chinese
    | 'indian'   // For Hindi
    | 'japanese'
    | 'tamil'
    | 'sanskrit'
    | 'serbian'
    | 'lithuanian';

/**
 * Maps common language names and ISO codes to Orama engine compatible languages.
 */
export function resolveEngineLanguage(language: string | undefined | null): OramaEngineLanguage {
    if (!language) return 'english';
    const normalized = language.toLowerCase().trim();

    // Direct name or ISO prefix matches for supported engine languages
    if (normalized.includes('arabic') || normalized.startsWith('ar')) return 'arabic';
    if (normalized.includes('armenian') || normalized.startsWith('hy')) return 'armenian';
    if (normalized.includes('bulgarian') || normalized.startsWith('bg')) return 'bulgarian';
    if (normalized.includes('danish') || normalized.startsWith('da')) return 'danish';
    if (normalized.includes('dutch') || normalized.startsWith('nl')) return 'dutch';
    if (normalized.includes('english') || normalized.startsWith('en')) return 'english';
    if (normalized.includes('finnish') || normalized.startsWith('fi')) return 'finnish';
    if (normalized.includes('french') || normalized.startsWith('fr')) return 'french';
    if (normalized.includes('german') || normalized.startsWith('de')) return 'german';
    if (normalized.includes('greek') || normalized.startsWith('el')) return 'greek';
    if (normalized.includes('hungarian') || normalized.startsWith('hu')) return 'hungarian';
    if (normalized.includes('indonesian') || normalized.startsWith('id')) return 'indonesian';
    if (normalized.includes('irish') || normalized.startsWith('ga')) return 'irish';
    if (normalized.includes('italian') || normalized.startsWith('it')) return 'italian';
    if (normalized.includes('nepali') || normalized.startsWith('ne')) return 'nepali';
    if (normalized.includes('norwegian') || normalized.startsWith('no')) return 'norwegian';
    if (normalized.includes('portuguese') || normalized.startsWith('pt')) return 'portuguese';
    if (normalized.includes('romanian') || normalized.startsWith('ro')) return 'romanian';
    if (normalized.includes('russian') || normalized.startsWith('ru')) return 'russian';
    if (normalized.includes('slovenian') || normalized.startsWith('sl')) return 'slovenian';
    if (normalized.includes('spanish') || normalized.startsWith('es')) return 'spanish';
    if (normalized.includes('swedish') || normalized.startsWith('sv')) return 'swedish';
    if (normalized.includes('turkish') || normalized.startsWith('tr')) return 'turkish';
    if (normalized.includes('ukrainian') || normalized.startsWith('uk')) return 'ukrainian';

    return 'english';
}

/**
 * Maps common language names and ISO codes to @orama/stopwords keys.
 */
export function resolveStopwordKey(language: string | undefined | null): OramaStopwordKey {
    if (!language) return 'english';
    const normalized = language.toLowerCase().trim();

    // Complex mappings not directly supported by engine name
    if (normalized.includes('chinese') || normalized.startsWith('zh')) return 'mandarin';
    if (normalized.includes('hindi') || normalized.startsWith('hi')) return 'indian';
    if (normalized.includes('japanese') || normalized.startsWith('ja')) return 'japanese';
    if (normalized.includes('tamil') || normalized.startsWith('ta')) return 'tamil';
    if (normalized.includes('sanskrit') || normalized.startsWith('sa')) return 'sanskrit';
    if (normalized.includes('serbian') || normalized.startsWith('sr')) return 'serbian';

    // Fallback to engine language mapping (which covers most cases)
    return resolveEngineLanguage(language) as OramaStopwordKey;
}

/**
 * Determines if a language string (name or code) represents a complex script.
 */
export function isComplexLanguage(language: string | undefined | null): boolean {
    if (!language) return false;
    const normalized = language.toLowerCase().trim();

    // CJK and other dense scripts
    if (normalized.includes('chinese') || normalized.startsWith('zh')) return true;
    if (normalized.includes('japanese') || normalized.startsWith('ja')) return true;
    if (normalized.includes('korean') || normalized.startsWith('ko')) return true;
    if (normalized.includes('arabic') || normalized.startsWith('ar')) return true;
    if (normalized.includes('hindi') || normalized.startsWith('hi')) return true;
    if (normalized.includes('thai') || normalized.startsWith('th')) return true;
    if (normalized.includes('hebrew') || normalized.startsWith('he')) return true;
    if (normalized.includes('tamil') || normalized.startsWith('ta')) return true;

    return false;
}
