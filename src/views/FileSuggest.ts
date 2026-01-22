import { AbstractInputSuggest, App, TFile, TFolder, TAbstractFile, MarkdownView, setIcon } from "obsidian";

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
        const cleanQuery = suggestQuery.trimStart();

        // 1. Get all visible markdown files to prioritize them
        const visibleFiles = new Set<string>();
        this.app.workspace.iterateRootLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                visibleFiles.add(leaf.view.file.path);
            }
        });

        // 2. Get all files and filter
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const matches: TAbstractFile[] = [];

        for (const file of abstractFiles) {
            if (file instanceof TFile || file instanceof TFolder) {
                if (file.path === "/") continue;

                const name = file instanceof TFile ? file.basename.toLowerCase() : file.name.toLowerCase();
                const path = file.path.toLowerCase();

                if (name.includes(cleanQuery) || path.includes(cleanQuery)) {
                    matches.push(file);
                }
            }
        }

        // 3. Sort:
        // - Name starts with query (if query present)
        // - Visible files
        // - Name includes query
        // - Path includes query
        // - Recency
        matches.sort((a, b) => {
            const aName = (a instanceof TFile ? a.basename : a.name).toLowerCase();
            const bName = (b instanceof TFile ? b.basename : b.name).toLowerCase();

            if (cleanQuery) {
                const aStarts = aName.startsWith(cleanQuery);
                const bStarts = bName.startsWith(cleanQuery);
                if (aStarts !== bStarts) return aStarts ? -1 : 1;
            }

            const aVisible = visibleFiles.has(a.path);
            const bVisible = visibleFiles.has(b.path);
            if (aVisible !== bVisible) return aVisible ? -1 : 1;

            if (cleanQuery) {
                const aIncludes = aName.includes(cleanQuery);
                const bIncludes = bName.includes(cleanQuery);
                if (aIncludes !== bIncludes) return aIncludes ? -1 : 1;
            }

            // Recency fallback for files
            const aTime = (a instanceof TFile) ? a.stat.mtime : 0;
            const bTime = (b instanceof TFile) ? b.stat.mtime : 0;
            return bTime - aTime;
        });

        return matches.slice(0, 20);
    }

    renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
        el.addClass("suggestion-item", "vault-intelligence-suggestion");

        const iconContainer = el.createDiv({ cls: "suggestion-icon" });
        setIcon(iconContainer, file instanceof TFolder ? "folder" : "file");

        const content = el.createDiv({ cls: "suggestion-content" });
        content.createDiv({ cls: "suggestion-title", text: file instanceof TFile ? file.basename : file.name });

        if (file.path !== (file instanceof TFile ? file.basename : file.name)) {
            content.createDiv({ cls: "suggestion-note", text: file.path });
        }
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
