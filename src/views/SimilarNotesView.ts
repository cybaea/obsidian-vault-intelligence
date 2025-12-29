import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { TaskType } from "@google/generative-ai";
import VaultIntelligencePlugin from "../main";
import { VectorStore } from "../services/VectorStore";
import { GeminiService } from "../services/GeminiService";
import { logger } from "../utils/logger";

export const SIMILAR_NOTES_VIEW_TYPE = "similar-notes-view";

export class SimilarNotesView extends ItemView {
    plugin: VaultIntelligencePlugin;
    vectorStore: VectorStore;
    gemini: GeminiService;

    constructor(leaf: WorkspaceLeaf, plugin: VaultIntelligencePlugin, vectorStore: VectorStore, gemini: GeminiService) {
        super(leaf);
        this.plugin = plugin;
        this.vectorStore = vectorStore;
        this.gemini = gemini;
    }

    getViewType() {
        return SIMILAR_NOTES_VIEW_TYPE;
    }

    getDisplayText() {
        return "Similar Notes";
    }

    async onOpen() {
        this.updateView();
        // Global listener logic will be in main.ts to trigger this view update
    }

    async onClose() {
        // Nothing to cleanup
    }

    public async updateForFile(file: TFile | null) {
        // Use contentEl usually
        const container = this.contentEl;
        container.empty();

        if (!file) {
            container.createEl("p", { text: "No active file." });
            return;
        }

        container.createEl("h4", { text: `Similar to: ${file.basename}` });
        const loadingEl = container.createEl("div", { text: "Finding similar notes..." });

        try {
            // Get embedding for current file LIVE (if modified) or from store?
            // "Only re-embed the active note live if it has unsaved changes." - actually for simplicity, 
            // let's just use the store if valid, or re-embed if needed.
            // But we need the vector to search OTHER vectors.

            // For now, let's just get the text and embed it to be sure we have the latest "query"
            const content = await this.plugin.app.vault.read(file);
            if (!content.trim()) {
                loadingEl.setText("File is empty.");
                return;
            }

            // embed as RETRIEVAL_QUERY because we are looking for other documents based on this one
            const embedding = await this.gemini.embedText(content, {
                taskType: TaskType.RETRIEVAL_QUERY
            });
            const similar = this.vectorStore.findSimilar(embedding);

            loadingEl.remove();

            if (similar.length === 0) {
                container.createEl("p", { text: "No similar notes found." });
            }

            const list = container.createEl("ul");
            similar.forEach(doc => {
                // Don't show the file itself
                if (doc.path === file.path) return;

                const item = list.createEl("li");
                const link = item.createEl("a", {
                    text: doc.path.split('/').pop() || doc.path,
                    cls: "nav-file-title-content"
                });
                link.setAttr("title", doc.path);

                // Display score
                const scorePercent = Math.round(doc.score * 100);
                item.createSpan({
                    text: ` (${scorePercent}%)`,
                    cls: "nav-file-tag" // use built-in style or similar
                });

                link.addEventListener("click", () => {
                    this.plugin.app.workspace.openLinkText(doc.path, "", true);
                });
            });

        } catch (e: any) {
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
