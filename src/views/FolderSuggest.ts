import { AbstractInputSuggest, App, TFolder, TAbstractFile } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    inputEl: HTMLInputElement | HTMLTextAreaElement;

    constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(app, inputEl as HTMLInputElement);
        this.inputEl = inputEl;
    }

    getSuggestions(query: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseQuery = query.toLowerCase();

        abstractFiles.forEach((file: TAbstractFile) => {
            if (file instanceof TFolder && file.path.toLowerCase().includes(lowerCaseQuery)) {
                folders.push(file);
            }
        });

        return folders.slice(0, 100);
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.inputEl.value = folder.path;
        this.inputEl.dispatchEvent(new Event("input"));
        this.close();
    }
}
