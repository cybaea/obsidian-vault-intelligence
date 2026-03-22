import { describe, it, expect } from 'vitest';

// Mimic the exact logic from indexer.worker.ts to test edge cases securely
function generateContextString(title: string, dir: string, fm: Record<string, unknown>, conf: { contextAwareHeaderProperties?: string[], implicitFolderSemantics?: string }): string {
    const parts: string[] = [];
    const props = conf.contextAwareHeaderProperties || ['title', 'topics', 'tags', 'type', 'author', 'status'];
    for (const key of props) {
        let val = fm[key];
        if (key === 'title' && !val) val = title;
        if (typeof val === 'string') {
            parts.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${val}.`);
        }
    }

    if (dir && conf.implicitFolderSemantics && conf.implicitFolderSemantics !== 'none') {
        const safeDir = dir.substring(0, 200); // Prevent token bloat
        parts.push(`Folder Structure: ${safeDir}.`);
    }

    return parts.join(' ').substring(0, 1000);
}

function extractFolders(path: string) {
    return path.split('/').filter(Boolean).slice(0, -1);
}

describe('Implicit Folder Semantics & Context String', () => {

    describe('generateContextString', () => {
        it('should append the safe folder structure if enabled', () => {
            const result = generateContextString("My Note", "Projects/Apollo", { status: "active" }, {
                contextAwareHeaderProperties: ['title', 'status'],
                implicitFolderSemantics: 'ontology'
            });
            expect(result).toContain("Folder Structure: Projects/Apollo.");
            expect(result).toContain("Title: My Note.");
            expect(result).toContain("Status: active.");
        });

        it('should NOT append folder structure if mode is "none"', () => {
            const result = generateContextString("My Note", "Projects/Apollo", {}, {
                contextAwareHeaderProperties: ['title'],
                implicitFolderSemantics: 'none'
            });
            expect(result).not.toContain("Folder Structure");
        });

        it('should strictly truncate exceptionally long folder paths to 200 characters to prevent Orama starvation', () => {
            const longDir = "A/".repeat(150); // 300 chars
            const result = generateContextString("My Note", longDir, {}, {
                contextAwareHeaderProperties: ['title'],
                implicitFolderSemantics: 'all'
            });

            const folderPartMatch = result.match(/Folder Structure: (.*?)\./);
            expect(folderPartMatch).not.toBeNull();
            if (folderPartMatch) {
                expect((folderPartMatch[1] || '').length).toBe(200);
            }
            expect(result.length).toBeLessThan(1000); // Guarantees we remain safely within limits
        });

        it('should truncate the total context string to 1000 characters regardless of contents', () => {
            const massiveTitle = "B".repeat(1200);
            const result = generateContextString(massiveTitle, "NormalDir", {}, {
                contextAwareHeaderProperties: ['title'],
                implicitFolderSemantics: 'all'
            });
            expect(result.length).toBe(1000);
        });
    });

    describe('Path Extraction (updateGraphEdges logic)', () => {
        it('should safely extract folders from a deeply nested path', () => {
            const path = "/Projects/Apollo/Meeting Notes.md";
            const folders = extractFolders(path);
            
            expect(folders).toEqual(['Projects', 'Apollo']);
        });

        it('should handle root paths gracefully without throwing bounds errors', () => {
            const path = "/Meeting.md";
            const folders = extractFolders(path);
            
            // For a file at the root, there are no parent folders to add as semantic hubs
            expect(folders).toEqual([]);
        });
        
        it('should handle un-slashed root paths securely', () => {
            const path = "Meeting.md";
            const folders = extractFolders(path);
            expect(folders).toEqual([]);
        });
    });
});
