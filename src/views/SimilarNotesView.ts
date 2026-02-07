import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

import { VIEW_TYPES } from "../constants";
import VaultIntelligencePlugin from "../main";
import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { IEmbeddingService } from "../services/IEmbeddingService";
import { GraphSearchResult } from "../types/graph";
import { logger } from "../utils/logger";

export class SimilarNotesView extends ItemView {
    plugin: VaultIntelligencePlugin;
    graphService: GraphService;
    gemini: GeminiService;
    embeddingService: IEmbeddingService; // Add Property

    // Update Constructor
    constructor(
        leaf: WorkspaceLeaf,
        plugin: VaultIntelligencePlugin,
        graphService: GraphService,
        gemini: GeminiService,
        embeddingService: IEmbeddingService // Add Argument
    ) {
        super(leaf);
        this.plugin = plugin;
        this.graphService = graphService;
        this.gemini = gemini;
        this.embeddingService = embeddingService;
        this.icon = "layout-grid";

        // Refresh when graph is ready
        this.plugin.graphService.on('index-ready', () => {
            void this.updateView();
        });
    }

    getViewType() {
        return VIEW_TYPES.SIMILAR_NOTES;
    }

    getDisplayText() {
        return "Explorer";
    }

    async onOpen() {
        await this.updateView();
        // Global listener logic will be in main.ts to trigger this view update
    }

    async onClose() {
        await Promise.resolve();
        // Nothing to cleanup
    }

    private lastUpdateId = 0;
    private lastPath = "";

    public async updateForFile(file: TFile | null, force = false) {
        if (!force && file?.path === this.lastPath && this.contentEl.children.length > 2) return;
        this.lastPath = file?.path || "";

        // Race condition fix: increment ID to invalidate previous running calls
        this.lastUpdateId++;
        const currentUpdateId = this.lastUpdateId;

        const container = this.contentEl;
        container.empty();
        if (!file) return;

        container.createEl("h4", { text: `Similar to: ${file.basename}` });

        if (!this.graphService.isReady || this.graphService.isScanning) {
            container.createEl("p", { cls: "loading-text", text: "Loading connections..." });
            return;
        }

        try {
            // 1. Get Content Matches (Vector)
            const vectorMatches = await this.graphService.getSimilar(file.path, this.plugin.settings.similarNotesLimit);
            if (this.lastUpdateId !== currentUpdateId) return;

            // 2. Get Topic/Graph Matches (Neighbors) -> THIS IS NEW
            const graphNeighbors = await this.graphService.getNeighbors(file.path, {
                direction: 'both',
                mode: 'ontology'
            });
            if (this.lastUpdateId !== currentUpdateId) return;

            // 3. Merge Strategies
            interface HybridSearchResult extends GraphSearchResult {
                reason?: string;
            }
            const merged = new Map<string, HybridSearchResult>();

            // Priority A: Graph Neighbors (Conceptually linked)
            graphNeighbors.forEach(n => {
                if (n.path !== file.path) {
                    // Boost score slightly to ensure visibility
                    merged.set(n.path, { ...n, reason: "Linked Topic", score: Math.max(n.score, 0.65) });
                }
            });

            // Priority B: Vector Matches (Content similar)
            vectorMatches.forEach(v => {
                if (v.path !== file.path) {
                    const existing = merged.get(v.path);
                    if (existing) {
                        // If matched both ways, boost significantly
                        existing.score = Math.max(existing.score, v.score + 0.1);
                        existing.reason = "Content + Topic";
                    } else {
                        merged.set(v.path, { ...v, reason: "Similar Content" });
                    }
                }
            });

            // 4. Sort & Display
            const finalResults = Array.from(merged.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, this.plugin.settings.similarNotesLimit);

            if (finalResults.length === 0) {
                container.createEl("p", { text: "No connections found." });
            }

            const list = container.createEl("ul");
            list.addClass("similar-notes-list");

            finalResults.forEach(doc => {
                const item = list.createEl("li");
                item.addClass("similar-notes-item");

                // Visual Indicator for Link Reason
                const score = Math.round(doc.score * 100);

                item.createSpan({
                    attr: { 'data-score-ten': Math.round(doc.score * 10).toString() },
                    cls: "similar-notes-score",
                    text: `${score}%`
                });

                const link = item.createEl("a", {
                    cls: "similar-notes-link",
                    text: doc.path.split('/').pop()?.replace('.md', '') || doc.path
                });

                link.addEventListener("click", () => {
                    void this.plugin.app.workspace.openLinkText(doc.path, "", true);
                });
            });

        } catch (e) {
            logger.error("Error updating similar notes", e);
        }
    }

    // Helper to just refresh the view
    public async updateView() {
        const file = this.plugin.app.workspace.getActiveFile();
        await this.updateForFile(file);
    }
}
