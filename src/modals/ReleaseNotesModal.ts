import { App, Modal, Plugin, MarkdownRenderer, ButtonComponent, setIcon, Component } from "obsidian";

import { UI_STRINGS, DOCUMENTATION_URLS } from "../constants";

export class ReleaseNotesModal extends Modal {
    plugin: Plugin;
    version: string;
    markdownContent: string;
    sponsorUrl?: string;

    constructor(app: App, plugin: Plugin, version: string, markdownContent: string, sponsorUrl?: string) {
        super(app);
        this.plugin = plugin;
        this.version = version;
        this.markdownContent = markdownContent;
        this.sponsorUrl = sponsorUrl;
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
            this as unknown as Component
        );

        // Footer / Close
        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        const sponsorUrl = this.sponsorUrl || DOCUMENTATION_URLS.SPONSOR;
        const sponsorBtn = new ButtonComponent(buttonContainer)
            .setButtonText(UI_STRINGS.MODAL_RELEASE_NOTES_SPONSOR)
            .onClick(() => {
                window.open(sponsorUrl, "_blank");
            });

        sponsorBtn.buttonEl.addClass("sponsor-button");
        setIcon(sponsorBtn.buttonEl, "heart");

        new ButtonComponent(buttonContainer)
            .setButtonText(UI_STRINGS.MODAL_RELEASE_NOTES_BUTTON)
            .setCta()
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
