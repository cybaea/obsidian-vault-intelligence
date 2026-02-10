/**
 * Supported Orama language keys.
 */
export type OramaLanguageKey =
    | 'arabic' | 'armenian' | 'bulgarian' | 'chinese' | 'danish' | 'dutch'
    | 'english' | 'finnish' | 'french' | 'german' | 'greek' | 'hindi'
    | 'hungarian' | 'indonesian' | 'irish' | 'italian' | 'nepali'
    | 'norwegian' | 'portuguese' | 'romanian' | 'russian' | 'sanskrit'
    | 'serbian' | 'slovenian' | 'spanish' | 'swedish' | 'tamil'
    | 'turkish' | 'ukrainian';

/**
 * Maps common language names and ISO codes to Orama-compatible keys.
 */
export function resolveLanguageKey(language: string | undefined | null): OramaLanguageKey {
    if (!language) return 'english';
    const normalized = language.toLowerCase().trim();

    // 1. Direct name matches (human readable names from settings)
    if (normalized.includes('arabic')) return 'arabic';
    if (normalized.includes('armenian')) return 'armenian';
    if (normalized.includes('bulgarian')) return 'bulgarian';
    if (normalized.includes('chinese')) return 'chinese';
    if (normalized.includes('danish')) return 'danish';
    if (normalized.includes('dutch')) return 'dutch';
    if (normalized.includes('english')) return 'english';
    if (normalized.includes('finnish')) return 'finnish';
    if (normalized.includes('french')) return 'french';
    if (normalized.includes('german')) return 'german';
    if (normalized.includes('greek')) return 'greek';
    if (normalized.includes('hindi')) return 'hindi';
    if (normalized.includes('hungarian')) return 'hungarian';
    if (normalized.includes('indonesian')) return 'indonesian';
    if (normalized.includes('irish')) return 'irish';
    if (normalized.includes('italian')) return 'italian';
    if (normalized.includes('nepali')) return 'nepali';
    if (normalized.includes('norwegian')) return 'norwegian';
    if (normalized.includes('portuguese')) return 'portuguese';
    if (normalized.includes('romanian')) return 'romanian';
    if (normalized.includes('russian')) return 'russian';
    if (normalized.includes('sanskrit')) return 'sanskrit';
    if (normalized.includes('serbian')) return 'serbian';
    if (normalized.includes('slovenian')) return 'slovenian';
    if (normalized.includes('spanish')) return 'spanish';
    if (normalized.includes('swedish')) return 'swedish';
    if (normalized.includes('tamil')) return 'tamil';
    if (normalized.includes('turkish')) return 'turkish';
    if (normalized.includes('ukrainian')) return 'ukrainian';

    // 2. ISO prefix matches
    if (normalized.startsWith('ar')) return 'arabic';
    if (normalized.startsWith('hy')) return 'armenian';
    if (normalized.startsWith('bg')) return 'bulgarian';
    if (normalized.startsWith('zh')) return 'chinese';
    if (normalized.startsWith('da')) return 'danish';
    if (normalized.startsWith('nl')) return 'dutch';
    if (normalized.startsWith('en')) return 'english';
    if (normalized.startsWith('fi')) return 'finnish';
    if (normalized.startsWith('fr')) return 'french';
    if (normalized.startsWith('de')) return 'german';
    if (normalized.startsWith('el')) return 'greek';
    if (normalized.startsWith('hi')) return 'hindi';
    if (normalized.startsWith('hu')) return 'hungarian';
    if (normalized.startsWith('id')) return 'indonesian';
    if (normalized.startsWith('ga')) return 'irish';
    if (normalized.startsWith('it')) return 'italian';
    if (normalized.startsWith('ne')) return 'nepali';
    if (normalized.startsWith('no')) return 'norwegian';
    if (normalized.startsWith('pt')) return 'portuguese';
    if (normalized.startsWith('ro')) return 'romanian';
    if (normalized.startsWith('ru')) return 'russian';
    if (normalized.startsWith('sa')) return 'sanskrit';
    if (normalized.startsWith('sr')) return 'serbian';
    if (normalized.startsWith('sl')) return 'slovenian';
    if (normalized.startsWith('es')) return 'spanish';
    if (normalized.startsWith('sv')) return 'swedish';
    if (normalized.startsWith('ta')) return 'tamil';
    if (normalized.startsWith('tr')) return 'turkish';
    if (normalized.startsWith('uk')) return 'ukrainian';

    return 'english';
}

/**
 * Determines if a language string (name or code) represents a complex script.
 */
export function isComplexLanguage(language: string | undefined | null): boolean {
    const key = resolveLanguageKey(language);
    const complexKeys: OramaLanguageKey[] = ['chinese', 'arabic', 'hindi', 'tamil'];

    // Japanese is a special case (no Orama stopwords listed in worker logic, but needs small chunks)
    const normalized = (language || '').toLowerCase();
    if (normalized.includes('japanese') || normalized.startsWith('ja')) {
        return true;
    }

    return complexKeys.includes(key);
}
