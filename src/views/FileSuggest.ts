import { AbstractInputSuggest, App, TFile } from "obsidian";

export class FileSuggest extends AbstractInputSuggest<TFile> {
    inputEl: HTMLTextAreaElement;

    constructor(app: App, inputEl: HTMLTextAreaElement) {
        super(app, inputEl as unknown as HTMLInputElement);
        this.inputEl = inputEl;
    }

    getSuggestions(query: string): TFile[] {
        const cursorPosition = this.inputEl.selectionStart;
        const textBeforeCursor = this.inputEl.value.substring(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf("@");

        if (lastAtIndex === -1) return [];

        const suggestQuery = textBeforeCursor.substring(lastAtIndex + 1).toLowerCase();

        // Clean query from punctuation as requested
        const cleanQuery = suggestQuery.replace(/[^\w\s]/g, "").trim();

        const files = this.app.vault.getMarkdownFiles();
        return files
            .filter(file => {
                const name = file.basename.toLowerCase();
                // Case-insensitive and basic fuzzy match
                return name.includes(cleanQuery) || name.replace(/[^\w\s]/g, "").includes(cleanQuery);
            })
            .slice(0, 10); // Limit to 10 suggestions
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.basename);
    }

    selectSuggestion(file: TFile): void {
        const cursorPosition = this.inputEl.selectionStart;
        const textBeforeCursor = this.inputEl.value.substring(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf("@");

        const textAfterCursor = this.inputEl.value.substring(cursorPosition);

        // Wrap in quotes if it contains spaces
        const replacement = file.basename.includes(" ") ? `"${file.basename}"` : file.basename;

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
