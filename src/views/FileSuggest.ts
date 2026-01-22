import { AbstractInputSuggest, App, TFile, TFolder, TAbstractFile } from "obsidian";

export class FileSuggest extends AbstractInputSuggest<TAbstractFile> {
    inputEl: HTMLTextAreaElement;

    constructor(app: App, inputEl: HTMLTextAreaElement) {
        super(app, inputEl as unknown as HTMLInputElement);
        this.inputEl = inputEl;
    }

    getSuggestions(query: string): TAbstractFile[] {
        const cursorPosition = this.inputEl.selectionStart;
        const textBeforeCursor = this.inputEl.value.substring(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf("@");

        if (lastAtIndex === -1) return [];

        const suggestQuery = textBeforeCursor.substring(lastAtIndex + 1).toLowerCase();

        // Only keep valid characters for matching, but allow multilingual characters
        // We trim leading whitespace but keep trailing if it exists for the match
        const cleanQuery = suggestQuery.trimStart();

        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const results: TAbstractFile[] = [];

        for (const file of abstractFiles) {
            if (file instanceof TFile || file instanceof TFolder) {
                // Skip root folder
                if (file.path === "/") continue;

                const name = file instanceof TFile ? file.basename.toLowerCase() : file.name.toLowerCase();
                const path = file.path.toLowerCase();

                if (name.includes(cleanQuery) || path.includes(cleanQuery)) {
                    results.push(file);
                }
            }
            if (results.length >= 20) break;
        }

        return results;
    }

    renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
        const icon = file instanceof TFolder ? "📁 " : "📄 ";
        el.setText(icon + (file instanceof TFile ? file.basename : file.path));
    }

    selectSuggestion(file: TAbstractFile): void {
        const cursorPosition = this.inputEl.selectionStart;
        const textBeforeCursor = this.inputEl.value.substring(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf("@");

        const textAfterCursor = this.inputEl.value.substring(cursorPosition);

        const name = file instanceof TFile ? file.basename : file.path;
        // Wrap in quotes if it contains spaces or special characters
        const replacement = (name.includes(" ") || /[^\w\s]/.test(name)) ? `"${name}"` : name;

        const newValue = textBeforeCursor.substring(0, lastAtIndex + 1) + replacement + " " + textAfterCursor;
        this.inputEl.value = newValue;

        // Move cursor after the inserted filename + space
        const newCursorPos = lastAtIndex + 1 + replacement.length + 1;
        this.inputEl.setSelectionRange(newCursorPos, newCursorPos);

        // Trigger input event to update TextAreaComponent internal value
        this.inputEl.dispatchEvent(new Event("input"));

        // Close the suggester immediately after selection
        this.close();
    }
}
