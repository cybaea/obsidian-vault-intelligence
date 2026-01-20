import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import VaultIntelligencePlugin from "../main";
import { GraphService } from "../services/GraphService";
import { GeminiService } from "../services/GeminiService";
import { IEmbeddingService } from "../services/IEmbeddingService"; // Import Interface
import { logger } from "../utils/logger";

export const SIMILAR_NOTES_VIEW_TYPE = "similar-notes-view";

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
    }

    getViewType() {
        return SIMILAR_NOTES_VIEW_TYPE;
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
        if (!force && file?.path === this.lastPath && this.contentEl.children.length > 2) {
            return; // Already showing this file and content seems valid
        }
        this.lastPath = file?.path || "";

        const updateId = ++this.lastUpdateId;
        const container = this.contentEl;
        container.empty();

        if (!file) {
            container.createEl("p", { text: "No active file." });
            return;
        }

        container.createEl("h4", { text: `Similar to: ${file.basename}` });
        const loadingEl = container.createEl("div", { text: "Finding similar notes..." });

        try {
            const similar = await this.graphService.getSimilar(file.path, this.plugin.settings.similarNotesLimit);

            // Check if a newer update has already started
            if (updateId !== this.lastUpdateId) return;

            loadingEl.remove();
            // Clear again to ensure no double-render if something else triggered update
            container.empty();
            container.createEl("h4", { text: `Similar to: ${file.basename}` });

            if (similar.length === 0) {
                container.createEl("p", { text: "No similar notes found." });
            }

            const list = container.createEl("ul");
            list.addClass("similar-notes-list");
            similar.forEach(doc => {
                const item = list.createEl("li");
                item.addClass("similar-notes-item");
                // Display score
                const scorePercent = Math.round(doc.score * 100);
                item.createSpan({
                    text: `${scorePercent}%`,
                    cls: "similar-notes-score"
                });

                const link = item.createEl("a", {
                    text: doc.path.split('/').pop() || doc.path,
                    cls: "similar-notes-link"
                });
                link.setAttr("title", doc.path);
                link.setAttr("data-score", String(scorePercent));
                link.setAttr("data-score-ten", String(Math.round(doc.score * 10)));

                link.addEventListener("click", () => {
                    void this.plugin.app.workspace.openLinkText(doc.path, "", true);
                });
            });

        } catch (e: unknown) {
            if (updateId === this.lastUpdateId) {
                loadingEl.setText("Error finding similar notes.");
                logger.error("Error updating similar notes view", e);
            }
        }
    }

    // Helper to just refresh the view
    public async updateView() {
        const file = this.plugin.app.workspace.getActiveFile();
        await this.updateForFile(file);
    }
}
