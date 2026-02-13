import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

import { VIEW_TYPES } from "../constants";
import VaultIntelligencePlugin from "../main";
import { GraphService } from "../services/GraphService";
import { logger } from "../utils/logger";

export class SimilarNotesView extends ItemView {
    plugin: VaultIntelligencePlugin;
    graphService: GraphService;

    // Update Constructor
    constructor(
        leaf: WorkspaceLeaf,
        plugin: VaultIntelligencePlugin,
        graphService: GraphService
    ) {
        super(leaf);
        this.plugin = plugin;
        this.graphService = graphService;
        this.icon = "layout-grid";

        // Refresh when graph is ready
        this.plugin.graphService.on('index-ready', () => {
            const file = this.plugin.app.workspace.getActiveFile();
            void this.updateForFile(file, true); // Force refresh
        });

        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        this.plugin.graphService.on('index-updated', () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                const file = this.plugin.app.workspace.getActiveFile();
                void this.updateForFile(file, true); // Force refresh
            }, 1000); // Debounce UI refresh by 1s to stop flicker
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
            // Hybrid Retrieval: Merged Vector + Graph Expansion (Preserves 0.65 floor and +0.1 boost)
            const limit = this.plugin.settings.similarNotesLimit;
            const finalResults = await this.graphService.getGraphEnhancedSimilar(file.path, limit);
            if (this.lastUpdateId !== currentUpdateId) return;

            if (finalResults.length === 0) {
                container.createEl("p", { text: "No connections found." });
            }

            const list = container.createEl("ul");
            list.addClass("similar-notes-list");

            finalResults.forEach(doc => {
                const item = list.createEl("li");
                item.addClass("similar-notes-item");

                const header = item.createDiv({ cls: "similar-notes-header" });

                const score = Math.round(doc.score * 100);
                header.createSpan({
                    attr: { 'data-score-ten': Math.round(doc.score * 10).toString() },
                    cls: "similar-notes-score",
                    text: `${score}%`
                });

                const link = header.createEl("a", {
                    cls: "similar-notes-link",
                    text: doc.path.split('/').pop()?.replace('.md', '') || doc.path
                });

                if (doc.description) {
                    item.createEl("p", {
                        cls: "similar-notes-description",
                        text: doc.description
                    });
                }

                if (doc.excerpt) {
                    item.createEl("p", {
                        cls: "similar-notes-excerpt",
                        text: doc.excerpt
                    });
                }

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
