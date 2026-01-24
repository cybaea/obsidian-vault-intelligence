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
    MAX_CHARS_PER_TOKENIZATION_BLOCK: 10000,

    /** Circuit Breaker: Reset after 5 minutes of no crashes */
    CIRCUIT_BREAKER_RESET_MS: 300000,

    /** Circuit Breaker: Window to detect crash loops (1 min) */
    CRASH_LOOP_WINDOW_MS: 60000,

    /** Stability: Threshold for "early crash" immediately after boot (10s) */
    BOOT_CRASH_THRESHOLD_MS: 10000,

    /** Circuit Breaker: Max crashes before giving up */
    MAX_CRASH_RETRY: 4
};

export const WORKER_INDEXER_CONSTANTS = {
    /** Default delay between index updates (ms) */
    DEFAULT_INDEXING_DELAY: 2000,

    /** Default minimum similarity for results (0.5 = 50%) */
    DEFAULT_MIN_SIMILARITY: 0.5,

    /** Strict similarity threshold for Orama (bypass default 0.8) */
    SIMILARITY_THRESHOLD_STRICT: 0.001,

    /** Default limit for simple keyword searches */
    SEARCH_LIMIT_DEFAULT: 5,

    /** Deep search limit for vector candidates before scoring */
    SEARCH_LIMIT_DEEP: 500,

    /** Length of content snippet to store in Orama for previews */
    CONTENT_PREVIEW_LENGTH: 500
};

export const UI_CONSTANTS = {
    /** Duration for basic notices (ms) */
    NOTICE_DURATION_MS: 5000,

    /** Duration for model validation notices (ms) */
    VALIDATION_NOTICE_MS: 5000,

    /** Default ratio of model capacity to use for Chat context budget (0.2 = 20%) */
    DEFAULT_CHAT_CONTEXT_RATIO: 0.2,

    /** Default ratio of model capacity to use for Gardener context budget (0.1 = 10%) */
    DEFAULT_GARDENER_CONTEXT_RATIO: 0.1
};

export const AGENT_CONSTANTS = {
    TOOLS: {
        VAULT_SEARCH: "vault_search",
        URL_READER: "read_url",
        GOOGLE_SEARCH: "google_search",
        CALCULATOR: "computational_solver"
    }
};

export const GARDENER_CONSTANTS = {
    PLAN_PREFIX: "Gardener Plan",
    PLAN_DATE_FORMAT: "YYYY-MM-DD HH-mm", // Conceptual format, implementation uses manual string building
    ACTIONS: {
        UPDATE_TOPICS: "update_topics"
    }
};
