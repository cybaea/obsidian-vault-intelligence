import { App, Modal, Plugin, MarkdownRenderer, ButtonComponent } from "obsidian";
import { UI_STRINGS } from "../constants";

export class ReleaseNotesModal extends Modal {
    plugin: Plugin;
    version: string;
    markdownContent: string;

    constructor(app: App, plugin: Plugin, version: string, markdownContent: string) {
        super(app);
        this.plugin = plugin;
        this.version = version;
        this.markdownContent = markdownContent;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("release-notes-modal");

        // Header
        contentEl.createEl("h2", { text: `${UI_STRINGS.MODAL_RELEASE_NOTES_TITLE} ${UI_STRINGS.PLUGIN_NAME} v${this.version}` });

        // Container for Markdown
        const markdownContainer = contentEl.createDiv({ cls: "release-notes-container" });



        // Render rich markdown (handles images, formatting, etc.)
        void MarkdownRenderer.render(
            this.app,
            this.markdownContent,
            markdownContainer,
            "/",
            // eslint-disable-next-line obsidianmd/no-plugin-as-component -- Modal lifetime is managed by user interaction, plugin instance is safe enough here
            this.plugin
        );

        // Footer / Close
        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });


        new ButtonComponent(buttonContainer)
            .setButtonText(UI_STRINGS.MODAL_RELEASE_NOTES_BUTTON)
            .setCta()
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
