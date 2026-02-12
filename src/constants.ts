/**
 * Centralized constants for the Obsidian Vault Intelligence plugin.
 * Grouped by logical area to improve maintainability.
 */


export const SEARCH_CONSTANTS = {
    /** Absolute minimum score for a seed to trigger neighbor expansion */
    ABSOLUTE_MIN_EXPANSION_SCORE: 0.40,

    ACCORDION_THRESHOLDS: {
        HIGH: 1.2,
        MED: 0.6
    },

    /** Estimated characters per token for context calculations (Standard approximation for English) */
    CHARS_PER_TOKEN_ESTIMATE: 4,

    /** Safety margin for context window (e.g. 0.8 = 80%) */
    CONTEXT_SAFETY_MARGIN: 0.8,

    /** Default cap for nodes considered in centrality calculation */
    DEFAULT_CENTRALITY_LIMIT: 50,

    /** Default safety cap for total documents in context */
    DEFAULT_CONTEXT_MAX_FILES: 100,

    /** Default relative threshold for full-file context inclusion */
    DEFAULT_CONTEXT_PRIMARY_THRESHOLD: 0.9,

    /** Default relative threshold for structural (headers) context inclusion */
    DEFAULT_CONTEXT_STRUCTURAL_THRESHOLD: 0.20,

    /** Default relative threshold for snippet context inclusion */
    DEFAULT_CONTEXT_SUPPORTING_THRESHOLD: 0.70,

    /** Default number of nodes to trigger graph expansion */
    DEFAULT_EXPANSION_SEEDS_LIMIT: 5,

    /** Default threshold for expansion seeds (relative to top score) */
    DEFAULT_EXPANSION_THRESHOLD: 0.7,

    /** Scoring: Multiplier for hits in long queries */
    FUZZY_LONG_HIT_MULTIPLIER: 0.08,

    /** Scoring: Threshold for query length to be considered "long" (tokens) */
    FUZZY_LONG_QUERY_THRESHOLD: 4,

    /** Scoring: Match ratio threshold for long queries (>= 4 tokens) */
    FUZZY_LONG_THRESHOLD: 0.3,

    /** Scoring: Minimum hits required in a long query to consider relevant */
    FUZZY_MIN_HITS_FOR_LONG_QUERY: 2,

    /** Scoring: Cap for fuzzy match score */
    FUZZY_SCORE_CAP: 0.75,

    /** Scoring: Base fuzzy match score for short queries */
    FUZZY_SHORT_BASE_SCORE: 0.4,

    /** Scoring: Match ratio threshold for short queries (< 4 tokens) */
    FUZZY_SHORT_THRESHOLD: 0.6,

    /** Search: Boosting score if result has both vector and keyword matches */
    HYBRID_BOOST_SCORE: 1.0,

    /** Search: Extra boost if keyword match is specifically in title */
    HYBRID_TITLE_BOOST: 0.5,

    /** Max number of keyword matches to find before stopping */
    MAX_KEYWORD_MATCHES: 100,

    /** Max number of structural (header-only) documents allowed in context */
    MAX_STRUCTURAL_DOCS: 10,

    /** Minimum characters required to bother adding a document snippet */
    MIN_DOC_CONTEXT_CHARS: 500,

    /** Default decay for neighbor expansion */
    NEIGHBOR_DECAY: 0.5,

    /** Scoring: Score for exact body match */
    SCORE_BODY_MATCH: 2.0,

    /** Scoring: Boost for exact title match */
    SCORE_TITLE_MATCH: 3.0,

    /** Max % of the budget a single document can consume if others are present */
    SINGLE_DOC_SOFT_LIMIT_RATIO: 0.10,

    /** Default weight for spreading activation */
    SPREADING_ACTIVATION_WEIGHT: 0.6,

    /** Default character limit for tool responses (truncation) */
    TOOL_RESPONSE_TRUNCATE_LIMIT: 5000,
    /** Search: Minimum threshold for vector results to be considered relevant */
    VECTOR_MIN_RELEVANCE: 0.35
};

export const EMBEDDING_CONSTANTS = {
    /** Backoff delay duration when hitting rate limits (ms) */
    BACKOFF_DELAY_MS: 30000,

    /** Default delay between embedding requests (ms) */
    DEFAULT_QUEUE_DELAY_MS: 300,

    /** Max concurrent requests to embedding APIs (usually 1 for rate limit safety) */
    MAX_CONCURRENT_REQUESTS: 1,

    /** Max consecutive errors before triggering a global queue backoff */
    MAX_ERRORS_BEFORE_BACKOFF: 5,

    /** Floating point precision for normalization checks */
    NORMALIZATION_PRECISION: 1e-6,

    /** Full backoff timeout before resuming queue (ms) */
    RESUME_TIMEOUT_MS: 60000
};

export const WORKER_CONSTANTS = {
    /** Stability: Threshold for "early crash" immediately after boot (10s) */
    BOOT_CRASH_THRESHOLD_MS: 10000,

    /** Circuit Breaker: Reset after 5 minutes of no crashes */
    CIRCUIT_BREAKER_RESET_MS: 300000,

    /** Circuit Breaker: Window to detect crash loops (1 min) */
    CRASH_LOOP_WINDOW_MS: 60000,

    /** Size of character blocks to process to avoid WASM heap exhaustion */
    MAX_CHARS_PER_TOKENIZATION_BLOCK: 10000,

    /** Circuit Breaker: Max crashes before giving up */
    MAX_CRASH_RETRY: 4,

    /** Token limit for most local models (standard BERT/MiniLM) */
    MAX_TOKENS: 512,

    /** Base URL for JS Delivr CDN for Transformers.js assets */
    WASM_CDN_URL: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/',

    /** Standard version for Xenova Transformers CDN */
    WASM_VERSION: '2.17.2'
};

export const WORKER_INDEXER_CONSTANTS = {
    /** Length of content snippet to store in Orama for previews */
    CONTENT_PREVIEW_LENGTH: 25000,

    /** Default max characters per semantic chunk if not specified by config */
    DEFAULT_MAX_CHUNK_CHARACTERS: 2000,

    /** Default minimum similarity for results (0.5 = 50%) */
    DEFAULT_MIN_SIMILARITY: 0.5,

    /** Default overlap ratio (0.1 = 10%) */
    DEFAULT_OVERLAP_RATIO: 0.1,

    /** * Orama Typo Tolerance:
     * Maximum Levenshtein distance (edits) allowed for a term to match.
     * 1-2 is standard for natural language.
     */
    KEYWORD_TOLERANCE: 2,

    /** * Absolute floor for keyword recall. 
     * In Orama v3, 1.0 implies logical OR (more permissive), 
     * while 0.0 implies logical AND (stricter).
     */
    RECALL_THRESHOLD_PERMISSIVE: 1, /** DO NOT CHANGE **/

    /** Deep search limit for vector candidates before scoring */
    SEARCH_LIMIT_DEEP: 500,

    /** Default limit for simple keyword searches */
    SEARCH_LIMIT_DEFAULT: 5,

    /** Overshoot factor for keyword search pooling */
    SEARCH_OVERSHOOT_FACTOR_KEYWORD: 3,

    /** Overshoot factor for vector search pooling */
    SEARCH_OVERSHOOT_FACTOR_VECTOR: 4,


    /** Strict similarity threshold for Orama (bypass default 0.8) */
    SIMILARITY_THRESHOLD_STRICT: 0.001
};

export const GRAPH_CONSTANTS = {
    /** Default indexing delay for currently active file (30s) */
    ACTIVE_FILE_INDEXING_DELAY_MS: 30000,
    /** Default directory for index storage (deprecated) */
    DATA_DIR: "data",
    /** Default indexing delay if not configured (5s) */
    DEFAULT_INDEXING_DELAY_MS: 5000,
    /** Scoring for Explorer (Vector + Graph) enhanced similarity */
    ENHANCED_SIMILAR_WEIGHTS: {
        HYBRID_BOOST: 0.1,
        NEIGHBOR_FLOOR: 0.65
    },
    /** Length of fallback excerpt when no vector match is found */
    FALLBACK_EXCERPT_LENGTH: 300,
    /** Search range (in characters) around original offsets for drift alignment */
    HYDRATION_SEARCH_RANGE: 5000,
    /** Throttle/Idle time before auto-saving graph state (ms) */
    IDLE_SAVE_TIMEOUT_MS: 30000,
    legacy_STATE_FILE: "graph-state.json",
    /** Max expansion depth to traverse (currently limited to 1 for performance) */
    MAX_EXPANSION_DEPTH: 1,
    /** Max neighbors to fetch per node to avoid state explosion */
    MAX_NEIGHBORS_PER_NODE: 5,
    MAX_SERIALIZATION_DEPTH: 1000,
    /** Number of files to process before logging progress during scan */
    SCAN_LOG_BATCH_SIZE: 50,
    /** Default filename for graph state */
    STATE_FILE: "graph-state.msgpack",

    /** Hidden directory in vault for plugin-specific persistent data */
    VAULT_DATA_DIR: ".vault-intelligence",
    /** Scoring Weights (alpha, beta, gamma) */
    WEIGHTS: {
        /** Spreading Activation (connectedness) weight */
        ACTIVATION: 0.5,
        /** Graph Centrality (structural) weight */
        CENTRALITY: 0.2,
        /** Vector Similarity weight */
        SIMILARITY: 0.6
    }
};

export const ONTOLOGY_CONSTANTS = {
    /** Weights for edge sources */
    EDGE_WEIGHTS: {
        BODY: 1.0,
        FRONTMATTER: 1.5
    },

    /** Minimum inbound links to be considered a 'Hub' if not in ontology folder */
    HUB_MIN_DEGREE: 2,

    /** Damping factor for Hubs: Score = Score / log(Degree + 1) */
    HUB_PENALTY_ENABLED: false,

    /** Dampening factor for 2-hop (Sibling) relevance */
    SIBLING_DECAY: 0.25
};

export const UI_CONSTANTS = {
    /** Default ratio of model capacity to use for Chat context budget (0.2 = 20%) */
    DEFAULT_CHAT_CONTEXT_RATIO: 0.2,

    /** Default ratio of model capacity to use for Gardener context budget (0.1 = 10%) */
    DEFAULT_GARDENER_CONTEXT_RATIO: 0.1,

    /** Minimum tokens to bother with for tokenization blocks */
    MAX_CHARS_PER_TOKENIZATION_BLOCK: 10000,

    /** Duration for basic notices (ms) */
    NOTICE_DURATION_MS: 5000,

    /** Duration for model validation notices (ms) */
    VALIDATION_NOTICE_MS: 5000
};

export const VIEW_TYPES = {
    RESEARCH_CHAT: "research-chat-view",
    SIMILAR_NOTES: "similar-notes-view"
};

export const AGENT_CONSTANTS = {
    TOOLS: {
        CALCULATOR: "computational_solver",
        CREATE_FOLDER: "create_folder",
        CREATE_NOTE: "create_note",
        GET_CONNECTED_NOTES: "get_connected_notes",
        GOOGLE_SEARCH: "google_search",
        LIST_FOLDER: "list_folder",
        READ_NOTE: "read_note",
        RENAME_NOTE: "rename_note",
        UPDATE_NOTE: "update_note",
        URL_READER: "read_url",
        VAULT_SEARCH: "vault_search"
    }
};

export const GARDENER_CONSTANTS = {
    ACTIONS: {
        UPDATE_TOPICS: "update_topics"
    },
    DEFAULT_AGENT_STEPS: 5,
    PLAN_DATE_FORMAT: "YYYY-MM-DD HH-mm", // Conceptual format, implementation uses manual string building
    PLAN_PREFIX: "Gardener Plan"
};

export const MODEL_REGISTRY_CONSTANTS = {
    /** Minimum context floor in tokens after budget adjustment */
    CONTEXT_ADJUSTMENT_FLOOR: 1024,

    /** Default cache duration for fetched models (days) */
    DEFAULT_CACHE_DURATION_DAYS: 7,

    /** Default input token limit if unknown */
    DEFAULT_TOKEN_LIMIT: 1048576,

    /** Score boost for standard (non-preview/non-experimental) models */
    PRODUCTION_BOOST: 50,
    /** Weighted scores for model sorting */
    SCORES: {
        EMBEDDING_BOOST: 10,
        EXPERIMENTAL_PENALTY: -50,
        FLASH_BOOST: 300,
        GEMINI_1_0: 1000,
        GEMINI_1_5: 2000,
        GEMINI_2: 2500,
        GEMINI_2_5: 3000,
        GEMINI_3: 4000,
        LITE_BOOST: 100,
        PREVIEW_PENALTY: -20,
        PRO_BOOST: 500
    }
};

export const SANITIZATION_CONSTANTS = {
    /** Default embedding dimension */
    DEFAULT_EMBEDDING_DIMENSION: 768,

    /** Absolute maximum token limit used for sanity checks */
    MAX_TOKEN_LIMIT_SANITY: 1048576,
    /** Minimum context tokens floor */
    MIN_TOKEN_LIMIT: 1024
};

export const UI_STRINGS = {
    ERROR_GARDENER_PLAN_RENDER: "Failed to render Gardener Plan",
    ERROR_GRAPH_INIT_FAILED: "Failed to initialize vault intelligence graph",
    EXPLORER_TITLE: "Explorer: view similar notes",
    GARDENER_TITLE_PURGE: "Gardener: purge old plans",
    GARDENER_TITLE_TIDY: "Gardener: organize vault concepts",
    MODAL_RELEASE_NOTES_BUTTON: "Cool!",
    MODAL_RELEASE_NOTES_DOCS: "Documentation",
    MODAL_RELEASE_NOTES_ERROR_BODY: "You have updated to **v{0}**.\n\nDepending on your network connection, we couldn't fetch the full release notes right now.\n\n[Click here to read the release notes on GitHub]({1})",
    MODAL_RELEASE_NOTES_ERROR_HEADER: "### Update Successful!",
    MODAL_RELEASE_NOTES_GITHUB: "GitHub",
    MODAL_RELEASE_NOTES_SPONSOR: "Sponsor",
    MODAL_RELEASE_NOTES_TITLE: "What's New in",
    NOTICE_GARDENER_FAILED: "Gardener failed: ",
    NOTICE_GARDENER_PURGED: "Gardener: old plans purged.",
    NOTICE_PLUGIN_LOADED: "Vault Intelligence Plugin Loaded",
    NOTICE_PLUGIN_UNLOADED: "Vault Intelligence Plugin Unloaded",
    NOTICE_PURGE_FAILED: "Purge failed: ",
    NOTICE_SANITISED_BUDGETS: "Sanitised context budgets to safe bounds",
    PLUGIN_NAME: "Vault Intelligence",
    RESEARCHER_SPOTLIGHT_HEADER: "⚡ Spotlight candidates",
    RESEARCHER_SYSTEM_NOTE_PREFIX: "*System Note:* ",
    RESEARCHER_TITLE: "Researcher: chat with vault",
    RIBBON_ICON: "brain-circuit",
    RIBBON_TOOLTIP: "Vault intelligence"
};

const DOCS_BASE = "https://cybaea.github.io/obsidian-vault-intelligence/";
const DOCS_CONFIG = `${DOCS_BASE}docs/reference/configuration.html`;

export const DOCUMENTATION_URLS = {
    BASE: DOCS_BASE,
    CONFIGURATION: DOCS_CONFIG,
    GITHUB: "https://github.com/cybaea/obsidian-vault-intelligence",
    SECTIONS: {
        CONNECTION: `${DOCS_CONFIG}#connection`,
        EXPLORER: `${DOCS_CONFIG}#explorer`,
        GARDENER: `${DOCS_CONFIG}#gardener`,
        PERFORMANCE: `${DOCS_CONFIG}#performance-and-system`,
        RESEARCHER: `${DOCS_CONFIG}#researcher`,
    },
    SPONSOR: "https://github.com/sponsors/cybaea"
};

export const VALIDATION_CONSTANTS = {
    /** Standard paths to check for ONNX weights */
    ONNX_PATHS: [
        'onnx/model_quantized.onnx', // Standard location for Xenova models
        'model_quantized.onnx',      // Root location (rare but possible)
        'onnx/model.onnx',           // Unquantized (Standard location)
        'model.onnx'                 // Unquantized (Root)
    ],
    /** Common supported architectures in Transformers.js */
    SUPPORTED_ARCHITECTURES: [
        'BertModel',
        'NomicBertModel',
        'MPNetModel',
        'RobertaModel',
        'DistilBertModel',
        'XLM_RoBERTaModel'
    ]
};

export const URL_CONSTANTS = {
    /** Allowed domains for downloading models or assets */
    TRUSTED_DOMAINS: [
        'huggingface.co',
        'jsdelivr.net',
        'raw.githubusercontent.com' // Often used for config but less common in this specific logic
    ]
};

export const REGEX_CONSTANTS = {
    /** Pattern to match @[link] or @link mentions */
    MENTION: /@(?:\[\[([^\]]+)\]\]|(\b[a-zA-Z0-9_\-./]+\b))/g
};

export const MODEL_CONSTANTS = {
    CHAT_MODEL: "gemini-pro",
    EMBEDDING_001: "gemini-embedding-001",
    TEXT_EMBEDDING_004: "text-embedding-004"
};

export const WORKER_LATENCY_CONSTANTS = {
    /** Multiple of chunk size allowed in the fast-path search */
    LATENCY_BUDGET_FACTOR: 4.0
};
