import { App, TFile, TAbstractFile } from "obsidian";

/**
 * VaultManager abstracts Obsidian vault operations.
 * This decouples core logic from the Obsidian API and facilitates testing.
 */
export class VaultManager {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Get all markdown files in the vault.
     */
    public getMarkdownFiles(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    /**
     * Read file content.
     */
    public async readFile(file: TFile): Promise<string> {
        return await this.app.vault.read(file);
    }

    /**
     * Get a file by path.
     */
    public getFileByPath(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return file;
        }
        return null;
    }

    /**
     * Listen to vault events.
     */
    public onModify(callback: (file: TFile) => void): void {
        this.app.vault.on('modify', (file: TAbstractFile) => {
            if (file instanceof TFile && file.extension === 'md') {
                callback(file);
            }
        });
    }

    public onDelete(callback: (path: string) => void): void {
        this.app.vault.on('delete', (file: TAbstractFile) => {
            if (file instanceof TFile && file.extension === 'md') {
                callback(file.path);
            }
        });
    }

    public onRename(callback: (oldPath: string, newPath: string) => void): void {
        this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile && file.extension === 'md') {
                callback(oldPath, file.path);
            }
        });
    }

    /**
     * Get basic metadata for a file.
     */
    public getFileStat(file: TFile) {
        return {
            basename: file.basename,
            mtime: file.stat.mtime,
            size: file.stat.size
        };
    }
}
