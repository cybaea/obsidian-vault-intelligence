import Graph from "graphology";
import { Events, App } from "obsidian";

import { GRAPH_CONSTANTS } from "../constants";
import { GraphSearchResult, GraphNodeData, SerializableGraphSearchResult } from "../types/graph";
import { ResultHydrator } from './ResultHydrator';
import { VaultManager } from "./VaultManager";
import { WorkerManager } from './WorkerManager';

export interface GraphState {
    graph?: {
        nodes?: Array<{ id: string; attributes?: GraphNodeData }>;
    };
}

export interface GraphTraversalOptions {
    decay?: number;
    direction?: 'both' | 'inbound' | 'outbound';
    mode?: 'simple' | 'ontology';
}

/**
 * Public Facade for the Graph and Vector index.
 * Provides a read-only API for queries and search.
 * Delegates all background syncing and lifecycle management to GraphSyncOrchestrator.
 */
export class GraphService extends Events {
    private app: App;
    private vaultManager: VaultManager;
    private workerManager: WorkerManager;
    private hydrator: ResultHydrator;

    // Injected by Orchestrator or Factory during boot
    private _isScanningProvider: () => boolean = () => false;
    private _isReadyProvider: () => boolean = () => false;

    constructor(
        app: App,
        vaultManager: VaultManager,
        workerManager: WorkerManager
    ) {
        super();
        this.app = app;
        this.vaultManager = vaultManager;
        this.workerManager = workerManager;
        this.hydrator = new ResultHydrator(app, vaultManager);
    }

    /**
     * Bridges state from the Orchestrator.
     */
    public setProviders(isReady: () => boolean, isScanning: () => boolean) {
        this._isReadyProvider = isReady;
        this._isScanningProvider = isScanning;
    }

    public get isReady(): boolean {
        return this._isReadyProvider();
    }

    public get isScanning(): boolean {
        return this._isScanningProvider();
    }

    /**
     * Semantically searches the vault using vector embeddings.
     */
    public async search(query: string, limit?: number): Promise<GraphSearchResult[]> {
        try {
            const rawResults = await this.workerManager.executeQuery(api => api.search(query, limit));
            return this.hydrateAndHandleDrift(rawResults);
        } catch {
            return [];
        }
    }

    /**
     * Performs a keyword search on the Orama index.
     */
    public async keywordSearch(query: string, limit?: number): Promise<GraphSearchResult[]> {
        try {
            const rawResults = await this.workerManager.executeQuery(api => api.keywordSearch(query, limit));
            return this.hydrateAndHandleDrift(rawResults);
        } catch {
            return [];
        }
    }

    /**
     * Semantically searches the vault within specific file paths.
     */
    public async searchInPaths(query: string, paths: string[], limit?: number): Promise<GraphSearchResult[]> {
        try {
            const rawResults = await this.workerManager.executeQuery(api => api.searchInPaths(query, paths, limit));
            return this.hydrateAndHandleDrift(rawResults);
        } catch {
            return [];
        }
    }

    /**
     * Gets similar notes based on vector distance.
     */
    public async getSimilar(path: string, limit?: number, minScore?: number): Promise<GraphSearchResult[]> {
        try {
            const rawResults = await this.workerManager.executeQuery(api => api.getSimilar(path, limit, minScore));
            const hydrated = await this.hydrateAndHandleDrift(rawResults);

            // Use default threshold if not provided
            const threshold = minScore ?? 0.5; // Default floor
            return hydrated.filter(r => r.score >= threshold);
        } catch {
            return [];
        }
    }

    /**
     * DUAL-LOOP: Explorer Method.
     * Merges vector-based similarity with graph-based neighbors for a hybrid result.
     */
    public async getGraphEnhancedSimilar(path: string, limit: number): Promise<GraphSearchResult[]> {
        const weights = GRAPH_CONSTANTS.ENHANCED_SIMILAR_WEIGHTS;

        // Fetch similarity from worker via Facade methods
        const [vectorResults, neighborResults] = await Promise.all([
            this.getSimilar(path, 50, 0.3), // Permissive floor to allow rescue
            this.getNeighbors(path, { direction: 'both', mode: 'ontology' })
        ]);

        const filteredVectors = vectorResults.filter(v => v.path !== path);
        const neighborPathSet = new Set(neighborResults.map(n => n.path));
        const vectorPathSet = new Set(filteredVectors.map(v => v.path));
        const mergedMap = new Map<string, GraphSearchResult>();

        // 1. Hybrid Boost
        for (const v of filteredVectors) {
            if (neighborPathSet.has(v.path)) {
                v.score = Math.min(1.0, v.score * weights.HYBRID_MULTIPLIER);
                v.description = "(Enhanced semantic connection)";
            }
            mergedMap.set(v.path, v);
        }

        // 2. Discovery Anchoring (Pure structural neighbors)
        const pureNeighbors = neighborResults
            .filter(n => !vectorPathSet.has(n.path) && n.path !== path)
            .sort((a, b) => b.score - a.score)
            .slice(0, weights.MAX_PURE_NEIGHBORS);

        // Hydrate neighbors to get metadata/excerpts
        const { hydrated: hydratedAnchors } = await this.hydrator.hydrate(pureNeighbors);
        const anchorScore = 0.49; // Just below default threshold

        for (const h of hydratedAnchors) {
            h.score = anchorScore;
            h.description = "(Structural neighbor)";
            mergedMap.set(h.path, h);
        }

        return Array.from(mergedMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Gets direct neighbors of a file in the graph.
     */
    public async getNeighbors(path: string, options?: GraphTraversalOptions): Promise<GraphSearchResult[]> {
        try {
            const neighbors = await this.workerManager.executeQuery(api => api.getNeighbors(path, options));
            return this.hydrateAndHandleDrift(neighbors);
        } catch {
            return [];
        }
    }

    /**
     * Gets a subgraph centered around a file with pre-calculated layout.
     */
    public async getSemanticSubgraph(path: string, updateId: number, existingPositions?: Record<string, { x: number, y: number }>, attractionMultiplier: number = 1.0): Promise<Graph | null> {
        try {
            const raw = await this.workerManager.executeQuery(api => api.getSubgraph(path, updateId, existingPositions, attractionMultiplier));

            // FIX: Gracefully handle null from aborted layout
            if (!raw) return null;

            const sub = new Graph({ type: 'undirected' });
            sub.import(raw as Parameters<typeof sub.import>[0]);

            return sub;
        } catch (e) {
            console.error(`[GraphService] Failed to get semantic subgraph for ${path}`, e);
            return null;
        }
    }

    /**
     * Gets structural importance metrics for a node.
     */
    public async getCentrality(path: string): Promise<number> {
        try {
            return await this.workerManager.executeQuery(api => api.getCentrality(path));
        } catch {
            return 0;
        }
    }

    /**
     * Gets metadata for multiple nodes in a single worker call.
     */
    public async getBatchMetadata(paths: string[]): Promise<Record<string, { title?: string; headers?: string[], tokenCount?: number }>> {
        try {
            return await this.workerManager.executeQuery(api => api.getBatchMetadata(paths));
        } catch {
            return {};
        }
    }

    /**
     * Builds the priority payload for Dual-Loop Search (RAG).
     */
    public async buildPriorityPayload(queryVector: number[], query: string): Promise<GraphSearchResult[]> {
        try {
            const hollowHits = await this.workerManager.executeQuery(api => api.buildPriorityPayload(queryVector, query)) as GraphSearchResult[];
            const hydrated = await this.hydrateAndHandleDrift(hollowHits);

            return hydrated.map(item => ({
                ...item,
                content: item.excerpt
            }));
        } catch {
            return [];
        }
    }

    /**
     * Internal helper to hydrate results and signal the Orchestrator on drift.
     */
    private async hydrateAndHandleDrift(results: SerializableGraphSearchResult[]): Promise<GraphSearchResult[]> {
        const { driftDetected, hydrated } = await this.hydrator.hydrate(results);

        for (const file of driftDetected) {
            this.trigger('graph:drift-detected', file);
        }

        return hydrated;
    }

    /**
     * Exposes the WorkerManager for advanced consumers (e.g. tests).
     */
    public getWorkerManager(): WorkerManager {
        return this.workerManager;
    }
}
