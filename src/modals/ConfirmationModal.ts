import { App, Modal, ButtonComponent } from "obsidian";

export class ConfirmationModal extends Modal {
    private onConfirm: () => void;
    private message: string;
    private title: string;

    constructor(app: App, title: string, message: string, onConfirm: () => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.title });
        contentEl.createEl("p", { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        const confirmBtn = new ButtonComponent(buttonContainer)
            .setButtonText("Confirm");
        confirmBtn.buttonEl.classList.add("mod-destructive");
        confirmBtn.onClick(() => {
                this.onConfirm();
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}
