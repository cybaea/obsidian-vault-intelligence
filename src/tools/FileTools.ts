import { App, TFile, TFolder, normalizePath } from "obsidian";

export class FileTools {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Strips any attempted frontmatter or YAML delimiters from agent output.
     * Strictly uses string operations, no regex.
     */
    private sanitizeAgentOutput(content: string): string {
        let sanitized = content.trim();

        // Remove leading --- blocks
        if (sanitized.startsWith("---")) {
            const nextNewline = sanitized.indexOf("\n", 3);
            if (nextNewline !== -1) {
                const secondSeparator = sanitized.indexOf("\n---", nextNewline);
                if (secondSeparator !== -1) {
                    // Find the end of that second separator line
                    let bodyStart = secondSeparator + 4;
                    while (bodyStart < sanitized.length && (sanitized[bodyStart] === "-" || sanitized[bodyStart] === " " || sanitized[bodyStart] === "\r" || sanitized[bodyStart] === "\t")) {
                        bodyStart++;
                    }
                    if (bodyStart < sanitized.length && sanitized[bodyStart] === "\n") {
                        bodyStart++;
                    }
                    sanitized = sanitized.substring(bodyStart).trim();
                }
            }
        }

        // Final safety check for any remaining leading --- (which might be just delimiters)
        while (sanitized.startsWith("---")) {
            const nextLine = sanitized.indexOf("\n");
            if (nextLine === -1) {
                sanitized = "";
                break;
            }
            sanitized = sanitized.substring(nextLine + 1).trim();
        }

        return sanitized;
    }

    /**
     * Separates existing frontmatter from the document body using Obsidian's MetadataCache.
     */
    private async splitFile(file: TFile): Promise<{ frontmatter: string, body: string }> {
        const content = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        const pos = cache?.frontmatterPosition;

        if (!pos) {
            return { body: content, frontmatter: "" };
        }

        const frontmatter = content.substring(0, pos.end.offset);
        const body = content.substring(pos.end.offset);

        return { body, frontmatter };
    }

    /**
     * Ensures a note has a YAML frontmatter block. Prepends an empty one if missing.
     */
    private async ensureFrontmatter(file: TFile): Promise<void> {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatterPosition) {
            return;
        }

        await this.app.vault.process(file, (content) => {
            if (content.startsWith("---")) return content; // Safety check
            return "---\n---\n" + content;
        });
    }

    private sanitizeContent(content: string): string {
        return this.sanitizeAgentOutput(content);
    }

    /**
     * Ensures the parent directory of a path exists, creating it recursively if needed.
     */
    private async ensureDirectory(path: string): Promise<void> {
        const segments = path.split("/").filter(s => s.length > 0);
        if (segments.length <= 1) return; // Root or just a file in root

        let currentPath = "";
        for (let i = 0; i < segments.length - 1; i++) {
            currentPath += (currentPath ? "/" : "") + segments[i];
            const abstractFile = this.app.vault.getAbstractFileByPath(currentPath);
            if (!abstractFile) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (e) {
                    // Ignore if folder exists but abstractFile was null for some reason (race condition)
                    if (!(e instanceof Error && e.message.includes("Folder already exists"))) {
                        throw e;
                    }
                }
            } else if (!(abstractFile instanceof TFolder)) {
                throw new Error(`Path component is not a folder: ${currentPath}`);
            }
        }
    }

    async createNote(path: string, content: string): Promise<string> {
        const normalizedPath = normalizePath(path.replace(/^\/+/, "") + (path.endsWith(".md") ? "" : ".md"));
        const sanitized = this.sanitizeContent(content);

        const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (existing) {
            throw new Error(`File already exists: ${normalizedPath}`);
        }

        await this.ensureDirectory(normalizedPath);
        // Always initialize with empty frontmatter to ensure safety for future updates
        const finalContent = "---\n---\n" + sanitized;
        await this.app.vault.create(normalizedPath, finalContent);
        return `Successfully created note: ${normalizedPath}`;
    }

    async updateNote(path: string, content: string, mode: "append" | "prepend" | "overwrite"): Promise<string> {
        const normalizedPath = normalizePath(path.replace(/^\/+/, "") + (path.endsWith(".md") ? "" : ".md"));
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // 1. Ensure frontmatter exists so we have a clean boundary
        await this.ensureFrontmatter(file);

        // 2. Split file into frontmatter and body
        const { body, frontmatter } = await this.splitFile(file);
        const sanitized = this.sanitizeContent(content);

        let newBody: string;
        const trimmedBody = body.trim();

        switch (mode) {
            case "append":
                newBody = (trimmedBody ? trimmedBody + "\n\n" : "") + sanitized;
                break;
            case "prepend":
                newBody = sanitized + (trimmedBody ? "\n\n" + trimmedBody : "");
                break;
            case "overwrite":
                newBody = sanitized;
                break;
            default:
                throw new Error(`Invalid update mode: ${mode as string}`);
        }

        const finalContent = frontmatter.trimEnd() + "\n\n" + newBody.trimStart();
        await this.app.vault.modify(file, finalContent);
        return `Successfully updated note: ${normalizedPath} (body ${mode})`;
    }

    async renameNote(path: string, newPath: string): Promise<string> {
        const normalizedOld = normalizePath(path.replace(/^\/+/, "") + (path.endsWith(".md") ? "" : ".md"));
        const normalizedNew = normalizePath(newPath.replace(/^\/+/, "") + (newPath.endsWith(".md") ? "" : ".md"));

        const file = this.app.vault.getAbstractFileByPath(normalizedOld);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedOld}`);
        }

        const existingNew = this.app.vault.getAbstractFileByPath(normalizedNew);
        if (existingNew) {
            throw new Error(`Target path already exists: ${normalizedNew}`);
        }

        await this.ensureDirectory(normalizedNew);
        await this.app.fileManager.renameFile(file, normalizedNew);
        return `Successfully renamed note to: ${normalizedNew}`;
    }

    async createFolder(path: string): Promise<string> {
        const normalizedPath = normalizePath(path.replace(/^\/+/, ""));
        const segments = normalizedPath.split("/").filter(s => s.length > 0);

        let currentPath = "";
        for (const segment of segments) {
            currentPath += (currentPath ? "/" : "") + segment;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                await this.app.vault.createFolder(currentPath);
            } else if (!(existing instanceof TFolder)) {
                throw new Error(`Path component is not a folder: ${currentPath}`);
            }
        }
        return `Successfully created folder path: ${normalizedPath}`;
    }

    listFolder(folderPath: string): string {
        const normalizedPath = normalizePath(folderPath.replace(/^\/+/, ""));
        const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(folder instanceof TFolder)) {
            throw new Error(`Folder not found: ${normalizedPath}`);
        }

        const files = folder.children.map(f => `- ${f.path} (${f instanceof TFolder ? "folder" : "file"})`);
        if (files.length === 0) return `Folder is empty: ${normalizedPath}`;

        return `Contents of ${normalizedPath}:\n${files.join("\n")}`;
    }

    async readNote(path: string): Promise<string> {
        const normalizedPath = normalizePath(path.replace(/^\/+/, "") + (path.endsWith(".md") ? "" : ".md"));
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        return await this.app.vault.read(file);
    }
}
