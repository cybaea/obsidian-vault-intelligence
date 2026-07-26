import { Platform } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureMcpServerEditor } from '../../src/settings/sections/mcp';
import { MCPServerConfig, IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { setMockApiVersion } from '../mocks/obsidian';

// The MCP editor reads Platform.isDesktopApp to decide whether to render
// the OAuth sub-section. The default obsidian mock sets isDesktopApp to
// true; tests toggle the mutable Platform object to drive both branches.
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual,
        Platform: { isDesktopApp: true, isMobile: false },
    };
});

/**
 * Recursive mock DOM element that records the `cls` argument of every
 * `createDiv` call so tests can assert whether the OAuth-status div was
 * rendered. The Obsidian editor code uses deeply nested createDiv/
 * createSpan/createEl chains, so each method returns a fresh tracked
 * element.
 */
let observedClasses: string[];
function makeTrackedContainer(): HTMLElement {
    function makeEl(): HTMLElement {
        const el: Record<string, unknown> = {
            addClass: vi.fn(),
            appendChild: vi.fn(),
            children: [],
            classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
            createDiv: vi.fn().mockImplementation((cls?: string) => {
                if (typeof cls === 'string' && cls === 'mcp-oauth-status') {
                    observedClasses.push('mcp-oauth-status');
                }
                return makeEl();
            }),
            createEl: vi.fn().mockImplementation(() => makeEl()),
            createSpan: vi.fn().mockImplementation(() => makeEl()),
            empty: vi.fn(),
            querySelector: vi.fn().mockReturnValue(null),
            remove: vi.fn(),
            setAttribute: vi.fn(),
            setText: vi.fn(),
            style: {},
            textContent: '',
            value: '',
        };
        return el as unknown as HTMLElement;
    }
    return makeEl();
}

function makePlugin(): IVaultIntelligencePlugin {
    const settings = {
        mcpServers: [],
    } as unknown as VaultIntelligenceSettings;
    return {
        app: { secretStorage: {} } as unknown as IVaultIntelligencePlugin['app'],
        mcpClientManager: { connections: new Map() },
        saveSettings: vi.fn(async () => {}),
        settings,
    } as unknown as IVaultIntelligencePlugin;
}

function makeRemoteServer(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
    return {
        enabled: true,
        id: 'srv',
        name: 'Remote',
        requireExplicitConfirmation: false,
        type: 'streamable_http',
        url: 'https://mcp.example.com',
        ...overrides,
    };
}

describe('MCP settings editor OAuth section visibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockApiVersion('1.12.0');
        // Reset to desktop default.
        (Platform as { isDesktopApp: boolean }).isDesktopApp = true;
        observedClasses = [];
    });

    it('renders the OAuth sub-section on desktop for remote server types', () => {
        const plugin = makePlugin();
        const container = makeTrackedContainer();

        expect(() =>
            configureMcpServerEditor(container, plugin, {} as never, makeRemoteServer(), -1, () => {}),
        ).not.toThrow();
        // The OAuth status div (desktop-only) is created.
        expect(observedClasses).toContain('mcp-oauth-status');
    });

    it('hides the OAuth sub-section on mobile', () => {
        (Platform as { isDesktopApp: boolean }).isDesktopApp = false;
        const plugin = makePlugin();
        const container = makeTrackedContainer();

        expect(() =>
            configureMcpServerEditor(container, plugin, {} as never, makeRemoteServer(), -1, () => {}),
        ).not.toThrow();
        // No OAuth status div on mobile.
        expect(observedClasses).not.toContain('mcp-oauth-status');
    });

    it('does not render the OAuth sub-section for stdio servers (even on desktop)', () => {
        const plugin = makePlugin();
        const container = makeTrackedContainer();
        const stdioServer = makeRemoteServer({ type: 'stdio' });

        expect(() =>
            configureMcpServerEditor(container, plugin, {} as never, stdioServer, -1, () => {}),
        ).not.toThrow();
        expect(observedClasses).not.toContain('mcp-oauth-status');
    });
});