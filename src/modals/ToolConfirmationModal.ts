import { App, Modal, ButtonComponent, MarkdownRenderer } from "obsidian";

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
    private resolve: (value: boolean) => void;

    constructor(app: App, details: ToolConfirmationDetails, resolve: (value: boolean) => void) {
        super(app);
        this.details = details;
        this.resolve = resolve;
    }

    static async open(app: App, details: ToolConfirmationDetails): Promise<boolean> {
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
            const valTd = row.createEl("td", { cls: "value", text: value });
            if (isWarning) valTd.addClass("warning-text");
        };

        addRow("Tool", this.details.tool);
        addRow("Action", this.details.action.toUpperCase());
        addRow("Path", this.details.path);

        if (this.details.newPath) {
            addRow("New path", this.details.newPath);
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

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- MarkdownRenderer requires a Component; this.app.workspace.activeLeaf?.view is used as a fallback but needs casting due to deprecated/unsafe access in this context.
            void MarkdownRenderer.render(this.app, previewText, previewContainer, "", (this.app.workspace as any).activeLeaf?.view);
        }

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        new ButtonComponent(buttonContainer)
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
                this.resolve(true);
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                this.resolve(false);
                this.close();
            });
    }

    onClose() {
        this.resolve(false);
        this.contentEl.empty();
    }
}
