/**
 * Centralized constants for the Obsidian Vault Intelligence plugin.
 * Grouped by logical area to improve maintainability.
 */

export const SEARCH_CONSTANTS = {
    /** Estimated characters per token for context calculations (Standard approximation for English) */
    CHARS_PER_TOKEN_ESTIMATE: 4,

    /** Safety margin for context window (e.g. 0.8 = 80%) */
    CONTEXT_SAFETY_MARGIN: 0.8,

    /** Max % of the budget a single document can consume if others are present */
    SINGLE_DOC_SOFT_LIMIT_RATIO: 0.25,

    /** Minimum characters required to bother adding a document snippet */
    MIN_DOC_CONTEXT_CHARS: 500,

    /** Default character limit for tool responses (truncation) */
    TOOL_RESPONSE_TRUNCATE_LIMIT: 5000,

    /** Scoring: Boost for exact title match */
    SCORE_TITLE_MATCH: 1.2,

    /** Scoring: Score for exact body match */
    SCORE_BODY_MATCH: 0.85,

    /** Scoring: Base fuzzy match score for short queries */
    FUZZY_SHORT_BASE_SCORE: 0.4,

    /** Scoring: Match ratio threshold for short queries (< 4 tokens) */
    FUZZY_SHORT_THRESHOLD: 0.6,

    /** Scoring: Match ratio threshold for long queries (>= 4 tokens) */
    FUZZY_LONG_THRESHOLD: 0.3,

    /** Scoring: Multiplier for hits in long queries */
    FUZZY_LONG_HIT_MULTIPLIER: 0.08,

    /** Scoring: Cap for fuzzy match score */
    FUZZY_SCORE_CAP: 0.75,

    /** Search: Minimum threshold for vector results to be considered relevant */
    VECTOR_MIN_RELEVANCE: 0.35,

    /** Search: Boosting score if result has both vector and keyword matches */
    HYBRID_BOOST_SCORE: 0.3,

    /** Search: Extra boost if keyword match is specifically in title */
    HYBRID_TITLE_BOOST: 0.5
};

export const EMBEDDING_CONSTANTS = {
    /** Max consecutive errors before triggering a global queue backoff */
    MAX_ERRORS_BEFORE_BACKOFF: 5,

    /** Max concurrent requests to embedding APIs (usually 1 for rate limit safety) */
    MAX_CONCURRENT_REQUESTS: 1,

    /** Default delay between embedding requests (ms) */
    DEFAULT_QUEUE_DELAY_MS: 300,

    /** Floating point precision for normalization checks */
    NORMALIZATION_PRECISION: 1e-6,

    /** Default indexing delay after typing stops (ms) */
    DEFAULT_INDEXING_DELAY_MS: 5000,

    /** Backoff delay duration when hitting rate limits (ms) */
    BACKOFF_DELAY_MS: 30000,

    /** Full backoff timeout before resuming queue (ms) */
    RESUME_TIMEOUT_MS: 60000
};

export const WORKER_CONSTANTS = {
    /** Standard version for Xenova Transformers CDN */
    WASM_VERSION: '2.17.2',

    /** Base URL for JS Delivr CDN for Transformers.js assets */
    WASM_CDN_URL: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/',

    /** Token limit for most local models (standard BERT/MiniLM) */
    MAX_TOKENS: 512,

    /** Size of character blocks to process to avoid WASM heap exhaustion */
    MAX_CHARS_PER_TOKENIZATION_BLOCK: 10000
};

export const UI_CONSTANTS = {
    /** Duration for basic notices (ms) */
    NOTICE_DURATION_MS: 5000,

    /** Duration for model validation notices (ms) */
    VALIDATION_NOTICE_MS: 5000
};
