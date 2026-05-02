import Graph from 'graphology';
import { describe, expect, it } from 'vitest';

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

// Mock of updateGraphEdges specifically for testing the implicit folder semantics edge injection logic
function mockUpdateGraphEdges(graph: Graph, path: string, _dir: string, aliasMap: Map<string, string>, config: { implicitFolderSemantics?: string, ontologyPath?: string }) {
    if (config.implicitFolderSemantics && config.implicitFolderSemantics !== 'none') {
        const folders = path.split('/').filter(Boolean).slice(0, -1);
        const ontologyRoot = (config.ontologyPath || 'Ontology').toLowerCase();
        
        for (const folder of folders) {
            const folderNameLower = folder.toLowerCase();
            let shouldInject = false;
            let targetResolved = aliasMap.get(folderNameLower) || folder;
            
            if (config.implicitFolderSemantics === 'ontology') {
                if (aliasMap.has(folderNameLower) && targetResolved.startsWith(ontologyRoot + '/')) {
                    const segments = targetResolved.split('/');
                    const targetBasename = (segments[segments.length - 1] || '').replace(/\.md$/i, '').toLowerCase();
                    const targetParentName = segments.length > 1 ? (segments[segments.length - 2] || '').toLowerCase() : '';
                    if (targetBasename && targetBasename !== targetParentName) {
                        shouldInject = true;
                    }
                }
            } else if (config.implicitFolderSemantics === 'all') {
                shouldInject = true;
                if (!aliasMap.has(folderNameLower)) {
                    targetResolved = `_implicit_folder_/${folder}`;
                }
            }
            
            if (shouldInject) {
                if (!graph.hasNode(targetResolved)) {
                    graph.addNode(targetResolved, { mtime: 0, path: targetResolved, size: 0, type: 'topic' });
                }
                
                if (!graph.hasEdge(path, targetResolved)) {
                    graph.addEdge(path, targetResolved, {
                        source: 'implicit-folder',
                        type: 'link',
                        weight: 0.8
                    });
                }
            }
        }
    }
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

    describe('Graph Edge Injection (updateGraphEdges)', () => {
        it('Mode none: should NOT inject any structural folder edges', () => {
            const graph = new Graph();
            const aliasMap = new Map<string, string>();
            graph.addNode('Projects/Apollo/Meeting.md');
            
            mockUpdateGraphEdges(graph, 'Projects/Apollo/Meeting.md', 'Projects/Apollo', aliasMap, { implicitFolderSemantics: 'none' });
            
            expect(graph.edges().length).toBe(0);
        });

        it('Mode ontology: should ONLY inject edges that match validated Ontology aliasMap items', () => {
            const graph = new Graph();
            const aliasMap = new Map<string, string>();
            
            aliasMap.set('apollo', 'ontology/projects/apollo.md'); // Valid match
            aliasMap.set('projects', 'ontology/projects.md'); // Valid match
            // We do not set 'genericfolder' in alias map
            
            graph.addNode('GenericFolder/Apollo/Meeting.md');
            
            mockUpdateGraphEdges(graph, 'GenericFolder/Apollo/Meeting.md', 'GenericFolder/Apollo', aliasMap, { implicitFolderSemantics: 'ontology', ontologyPath: 'ontology' });
            
            // Should only inject edge to Apollo, ignoring GenericFolder
            const edges = graph.edges('GenericFolder/Apollo/Meeting.md');
            expect(edges.length).toBe(1);
            expect(graph.hasEdge('GenericFolder/Apollo/Meeting.md', 'ontology/projects/apollo.md')).toBe(true);
            expect(graph.hasNode('ontology/projects/apollo.md')).toBe(true);
        });

        it('Mode all: should inject ALL folders as virtual graph topics if not in aliasMap', () => {
            const graph = new Graph();
            const aliasMap = new Map<string, string>();
            
            graph.addNode('Projects/Apollo/Meeting.md');
            
            mockUpdateGraphEdges(graph, 'Projects/Apollo/Meeting.md', 'Projects/Apollo', aliasMap, { implicitFolderSemantics: 'all' });
            
            const edges = graph.edges('Projects/Apollo/Meeting.md');
            expect(edges.length).toBe(2);
            expect(graph.hasEdge('Projects/Apollo/Meeting.md', '_implicit_folder_/Projects')).toBe(true);
            expect(graph.hasEdge('Projects/Apollo/Meeting.md', '_implicit_folder_/Apollo')).toBe(true);
        });
        
        it('Mode all: should correctly resolve folder names to aliasMap if they happen to exist', () => {
            const graph = new Graph();
            const aliasMap = new Map<string, string>();
            
            aliasMap.set('apollo', 'ontology/projects/apollo.md');
            
            graph.addNode('Projects/Apollo/Meeting.md');
            
            mockUpdateGraphEdges(graph, 'Projects/Apollo/Meeting.md', 'Projects/Apollo', aliasMap, { implicitFolderSemantics: 'all' });
            
            // "Projects" goes to virtual node. "Apollo" goes to formal aliasMap node.
            expect(graph.hasEdge('Projects/Apollo/Meeting.md', '_implicit_folder_/Projects')).toBe(true);
            expect(graph.hasEdge('Projects/Apollo/Meeting.md', 'ontology/projects/apollo.md')).toBe(true);
        });
    });
});
