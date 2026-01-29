import Graph from 'graphology';
import { describe, it, expect } from 'vitest';

// Mocking the Graph Logic from indexer.worker.ts purely for logic testing

describe('Ontology Graph Traversal Logic', () => {

    it('should respect configured ontology path for finding siblings', () => {
        // Setup scenarios with different ontology paths
        const scenarios = [
            { configPath: 'Ontology', shouldMatch: true, topic: 'Ontology/Code.md' },
            { configPath: 'Concepts', shouldMatch: true, topic: 'Concepts/Software.md' },
            { configPath: 'Ontology', shouldMatch: false, topic: 'Concepts/Software.md' }, // Mismatch
        ];

        for (const { configPath, shouldMatch, topic } of scenarios) {
            const g = new Graph({ type: 'directed' });
            const journal = 'Journal.md';
            const sibling = 'Sibling.md';

            g.addNode(journal);
            g.addNode(topic);
            g.addNode(sibling);

            // Links TO the topic
            g.addEdge(journal, topic);
            g.addEdge(sibling, topic);

            // Simulation of Worker Logic
            const neighbors = g.neighbors(journal); // [topic]
            let foundSibling = false;

            for (const n of neighbors) {
                // The Logic Under Test:
                const configuredOntology = configPath; // In worker: config.ontologyPath
                const isOntologyPath = n.startsWith(configuredOntology + '/');

                if (isOntologyPath) {
                    const siblings = g.neighbors(n); // In/Out mixed in graphology unless specified
                    if (siblings.includes(sibling)) {
                        foundSibling = true;
                    }
                }
            }

            if (shouldMatch) {
                expect(foundSibling).toBe(true);
            } else {
                expect(foundSibling).toBe(false);
            }
        }
    });

    it('should normalize paths correctly for comparison', () => {
        const configPath = 'Ontology//'; // Trailing slash mess
        const topic = 'Ontology/Note.md';

        const normalize = (p: string) => p.replace(/\/+$/, '');
        const cleanConfig = normalize(configPath); // 'Ontology'

        expect(topic.startsWith(cleanConfig + '/')).toBe(true);
    });
});
