import { App } from 'obsidian';
import { describe, expect, it } from 'vitest';

import configurationReference from '../../docs/reference/configuration.md?raw';
import { VaultIntelligenceSettingTab } from '../../src/settings/settingsTab';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

/**
 * Anti-drift guard for docs/reference/configuration.md (documentation review
 * item 10): the reference must list every settings tab in UI order, every
 * group heading, and every setting row that the declarative definitions —
 * the same source the settings UI renders on Obsidian v1.13+ — expose.
 *
 * Allowlist policy, each with its reason:
 * - Dynamic per-model rows are generated from the fetched model registry, so
 *   their labels are not stable source constants; the reference documents the
 *   "Model filtering" group generically (one paragraph). The group heading
 *   itself is still asserted.
 * - "MCP Tools" is a page factory in the definitions; the reference covers it
 *   with a table plus a cross-link to the dedicated MCP guide, so only the
 *   tab heading is asserted.
 * - "Database shards" is documented as the group description under
 *   "Active database shards" (the settings window shows the shard list without
 *   a named row of its own), so that name is allowlisted with this reason.
 */
interface TestDefinitionItem {
    desc?: string;
    heading?: string;
    items?: TestDefinitionItem[];
    name?: string;
    page?: () => unknown;
    render?: unknown;
    type?: string;
}

interface TestDefinitionPage {
    desc?: string;
    items?: TestDefinitionItem[];
    name: string;
    page?: () => unknown;
    type: string;
}

/** Groups with generated, non-stable row names; children are skipped. */
const DYNAMIC_GROUP_HEADINGS: ReadonlySet<string> = new Set(['Model filtering']);

/** Setting rows documented as group-level behaviour instead of a row of their own. */
const SKIPPED_SETTING_NAMES: ReadonlyMap<string, string> = new Map([
    [
        'Database shards',
        'The settings window shows the shard list without a named row; its behaviour is documented as the group description under "Active database shards".',
    ],
]);

/** The settings tab uses the plural page name; the reference H2 is singular. */
const PAGE_NAME_TO_DOC_HEADING: ReadonlyMap<string, string> = new Map([
    ['Connections', 'Connection'],
]);

interface RefExpectation {
    kind: 'page' | 'group' | 'setting';
    name: string;
}

function collect(entries: TestDefinitionItem[], out: RefExpectation[]): void {
    for (const entry of entries) {
        if (entry.heading !== undefined) {
            out.push({ kind: 'group', name: entry.heading });
            if (!DYNAMIC_GROUP_HEADINGS.has(entry.heading) && entry.items !== undefined) {
                collect(entry.items, out);
            }
        } else if (entry.name !== undefined && !SKIPPED_SETTING_NAMES.has(entry.name)) {
            out.push({ kind: 'setting', name: entry.name });
        }
    }
}

function mockPlugin(): IVaultIntelligencePlugin {
    return {
        app: {} as App,
        saveSettings: () => Promise.resolve(),
        settings: {
            chatModel: 'gemini-flash-latest',
            embeddingDimension: 768,
            embeddingModel: 'gemini-embedding-001',
            embeddingProvider: 'gemini',
            hiddenModels: [],
        } as unknown as VaultIntelligenceSettings,
    } as unknown as IVaultIntelligencePlugin;
}

describe('Docs: configuration reference stays in sync with the settings UI', () => {
    const doc: string = configurationReference;

    it('contains the seven tab headings, in the order the settings UI shows them', () => {
        const order: string[] = [
            'Connection',
            'Researcher',
            'Explorer',
            'Gardener',
            'Storage',
            'MCP Tools',
            'Advanced',
        ];
        let previous: number | null = null;
        for (let i = 0; i < order.length; i += 1) {
            const name: string | undefined = order[i];
            const position: number = doc.indexOf(`\n## ${name}\n`);
            expect(name, `Reference page tab list is malformed at index ${i}`).toBeDefined();
            expect(position, `Missing "## ${name}" on the reference page`).not.toBe(-1);
            if (previous !== null) {
                expect(
                    position,
                    `"## ${order[i - 1]}" must appear before "## ${order[i]}" on the reference page`
                ).toBeGreaterThan(previous);
            }
            previous = position;
        }
    });

    it('lists every group heading and setting row from the declarative settings definitions', () => {
        const tab = new VaultIntelligenceSettingTab({} as App, mockPlugin());
        setMockApiVersion('1.13.0');
        const definitions: TestDefinitionPage[] =
            tab.getSettingDefinitions() as unknown as TestDefinitionPage[];

        expect(definitions).toHaveLength(7);

        const expectations: RefExpectation[] = [];
        for (const definition of definitions) {
            if (definition.page !== undefined && definition.items === undefined) {
                // Page factory (MCP Tools): assert the tab heading only.
                const docHeading: string =
                    PAGE_NAME_TO_DOC_HEADING.get(definition.name) ?? definition.name;
                expectations.push({ kind: 'page', name: docHeading });
            } else if (definition.items !== undefined) {
                collect(definition.items, expectations);
            }
        }

        const failures: string[] = [];
        for (const expectation of expectations) {
            if (expectation.kind === 'page') {
                if (!doc.includes(`\n## ${expectation.name}\n`)) {
                    failures.push(`missing tab heading "## ${expectation.name}"`);
                }
            } else if (expectation.kind === 'group') {
                if (!doc.includes(`\n### ${expectation.name}\n`)) {
                    failures.push(`missing group heading "### ${expectation.name}"`);
                }
            } else if (!doc.includes(expectation.name)) {
                failures.push(`missing setting row "${expectation.name}"`);
            }
        }

        expect(
            failures,
            `docs/reference/configuration.md is out of sync with the settings UI: ${failures.join('; ')}`
        ).toEqual([]);
    });

    it('never links to local file paths (file:/// regression)', () => {
        expect(doc.includes('file:///')).toBe(false);
    });
});