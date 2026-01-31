import { App, Modal, ButtonComponent, MarkdownRenderer, TextComponent, Component } from "obsidian";

import { FolderSuggest } from "../views/FolderSuggest";

export interface ToolConfirmationDetails {
    action: "create" | "update" | "rename" | "delete" | "folder";
    content?: string;
    mode?: string;
    newPath?: string;
    path: string;
    tool: string;
}

export class ToolConfirmationModal extends Modal {
    private details: ToolConfirmationDetails;
    private resolve: (value: ToolConfirmationDetails | null) => void;

    constructor(app: App, details: ToolConfirmationDetails, resolve: (value: ToolConfirmationDetails | null) => void) {
        super(app);
        this.details = details;
        this.resolve = resolve;
    }

    static async open(app: App, details: ToolConfirmationDetails): Promise<ToolConfirmationDetails | null> {
        return new Promise((resolve) => {
            const modal = new ToolConfirmationModal(app, details, resolve);
            modal.open();
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("tool-confirmation-modal");

        contentEl.createEl("h2", { text: "Confirm agent action" });

        const info = contentEl.createDiv({ cls: "confirmation-info" });
        info.createEl("p", { text: `The agent wants to perform the following action:` });

        const table = info.createEl("table", { cls: "confirmation-table" });

        const addRow = (label: string, value: string, isWarning = false) => {
            const row = table.createEl("tr");
            row.createEl("td", { cls: "label", text: label });
            const valTd = row.createEl("td", { cls: "value" });
            if (isWarning) valTd.addClass("warning-text");
            return valTd;
        };

        addRow("Tool", this.details.tool);
        addRow("Action", this.details.action.toUpperCase());

        const pathTd = addRow("Path", "");
        const pathInput = new TextComponent(pathTd)
            .setValue(this.details.path)
            .setPlaceholder("Enter path...")
            .onChange((val) => {
                this.details.path = val;
            });
        pathInput.inputEl.addClass("confirmation-input");
        new FolderSuggest(this.app, pathInput.inputEl);

        if (this.details.newPath) {
            const newPathTd = addRow("New path", "");
            const newPathInput = new TextComponent(newPathTd)
                .setValue(this.details.newPath)
                .setPlaceholder("Enter new path...")
                .onChange((val) => {
                    this.details.newPath = val;
                });
            newPathInput.inputEl.addClass("confirmation-input");
            new FolderSuggest(this.app, newPathInput.inputEl);
        }

        if (this.details.mode) {
            const isOverwrite = this.details.mode === "overwrite";
            addRow("Update mode", this.details.mode.toUpperCase(), isOverwrite);
            if (isOverwrite) {
                const warnBox = contentEl.createDiv({ cls: "confirmation-warning-box" });
                warnBox.createEl("strong", { text: "Warning: " });
                warnBox.createSpan({ text: "This will completely overwrite the existing note content." });
            }
        }

        if (this.details.content) {
            contentEl.createEl("h4", { text: "Content preview" });
            const previewContainer = contentEl.createDiv({ cls: "confirmation-preview" });
            // Simple preview, maybe truncated if too large
            const previewText = this.details.content.length > 2000
                ? this.details.content.substring(0, 2000) + "\n\n... (truncated)"
                : this.details.content;

            void MarkdownRenderer.render(this.app, previewText, previewContainer, "", this as unknown as Component);
        }

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        new ButtonComponent(buttonContainer)
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
                this.resolve(this.details);
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                this.resolve(null);
                this.close();
            });
    }

    onClose() {
        this.resolve(null);
        this.contentEl.empty();
    }
}
