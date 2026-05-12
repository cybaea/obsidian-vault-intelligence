declare module '@eslint-community/eslint-plugin-eslint-comments';

// Defined by esbuild at build time
declare const TRANSFORMERS_VERSION: string;

declare module "*/indexer.worker" {
    export default class IndexerWorker extends Worker {
        constructor();
    }
}

/**
 * Obsidian global helper to create a DocumentFragment.
 * This is safer than native createDocumentFragment for multi-window support.
 */
declare function createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
