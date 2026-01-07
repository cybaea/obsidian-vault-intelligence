import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import VaultIntelligencePlugin from "../main";
import { VectorStore } from "../services/VectorStore";
import { GeminiService } from "../services/GeminiService";
import { IEmbeddingService } from "../services/IEmbeddingService"; // Import Interface
import { logger } from "../utils/logger";

export const SIMILAR_NOTES_VIEW_TYPE = "similar-notes-view";

export class SimilarNotesView extends ItemView {
    plugin: VaultIntelligencePlugin;
    vectorStore: VectorStore;
    gemini: GeminiService;
    embeddingService: IEmbeddingService; // Add Property

    // Update Constructor
    constructor(
        leaf: WorkspaceLeaf, 
        plugin: VaultIntelligencePlugin, 
        vectorStore: VectorStore, 
        gemini: GeminiService,
        embeddingService: IEmbeddingService // Add Argument
    ) {
        super(leaf);
        this.plugin = plugin;
        this.vectorStore = vectorStore;
        this.gemini = gemini;
        this.embeddingService = embeddingService;
    }

    getViewType() {
        return SIMILAR_NOTES_VIEW_TYPE;
    }

    getDisplayText() {
        return "Similar notes";
    }

    async onOpen() {
        await this.updateView();
        // Global listener logic will be in main.ts to trigger this view update
    }

    async onClose() {
        await Promise.resolve();
        // Nothing to cleanup
    }

    public async updateForFile(file: TFile | null) {
        const container = this.contentEl;
        container.empty();

        if (!file) {
            container.createEl("p", { text: "No active file." });
            return;
        }

        container.createEl("h4", { text: `Similar to: ${file.basename}` });
        const loadingEl = container.createEl("div", { text: "Finding similar notes..." });

        try {
            // 1. Try to get cached vector from store
            let embedding = this.vectorStore.getVector(file.path);

            // 2. Fallback to API if missing
            if (!embedding) {
                const content = await this.plugin.app.vault.read(file);
                if (!content.trim()) {
                    loadingEl.setText("File is empty.");
                    return;
                }

                logger.debug(`Cached vector not found for ${file.path}, embedding live...`);
                
                // CHANGE: Use embeddingService instead of gemini.embedText
                embedding = await this.embeddingService.embedDocument(content, file.basename);
            }

            const similar = this.vectorStore.findSimilar(
                embedding,
                this.plugin.settings.similarNotesLimit,
                this.plugin.settings.minSimilarityScore,
                file.path
            );

            loadingEl.remove();

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
                    cls: "similar-notes-score" // use built-in style or similar
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
            loadingEl.setText("Error finding similar notes.");
            logger.error("Error updating similar notes view", e);
        }
    }

    // Helper to just refresh the view
    public async updateView() {
        const file = this.plugin.app.workspace.getActiveFile();
        await this.updateForFile(file);
    }
}
