import { afterEach, vi } from 'vitest';

import { setMockApiVersion } from './mocks/obsidian';

// Reset the mock API version after each test to prevent cross-test leakage.
// Tests that need a specific version set it in beforeEach or per-test.
// This ensures a test file's setMockApiVersion('1.13.0') does not leak into
// other test files, which would cause isolation failures (T4 fix).
afterEach(() => {
    setMockApiVersion('1.12.0');
});

const g = globalThis as any;

const mockEl = (): any => ({
    addClass: vi.fn(),
    append: vi.fn(),
    appendChild: vi.fn(),
    appendText: vi.fn(),
    createDiv: vi.fn().mockImplementation(() => mockEl()),
    createEl: vi.fn().mockImplementation(() => mockEl()),
    createSpan: vi.fn().mockImplementation(() => mockEl()),
    empty: vi.fn(),
    remove: vi.fn(),
    setAttribute: vi.fn(),
    setText: vi.fn(),
    style: {}
});

const mockDoc = {
    body: mockEl(),
    createDiv: vi.fn().mockImplementation(() => mockEl()),
    createDocumentFragment: vi.fn().mockImplementation(() => ({
        append: vi.fn(),
        appendChild: vi.fn(),
        appendText: vi.fn(),
        createDiv: vi.fn().mockImplementation(() => mockEl()),
        createEl: vi.fn().mockImplementation(() => mockEl()),
        createSpan: vi.fn().mockImplementation(() => mockEl())
    })),
    createEl: vi.fn().mockImplementation(() => mockEl()),
    createElement: vi.fn().mockImplementation(() => mockEl()),
    createSpan: vi.fn().mockImplementation(() => mockEl()),
    win: g
};

g.activeDocument = mockDoc;
g.activeWindow = g;
g.document = mockDoc;
g.window = g;

g.getComputedStyle = vi.fn().mockReturnValue({
    color: "rgb(0, 0, 0)",
    getPropertyValue: vi.fn().mockReturnValue("")
});

g.ResizeObserver = vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn(),
}));

g.IntersectionObserver = vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn()
}));
g.createFragment = vi.fn().mockImplementation((callback?: (el: any) => void) => {
    const frag = mockDoc.createDocumentFragment();
    // The mock fragment from mockDoc lacks appendText; add it so render
    // closures that build desc fragments (e.g. explorer.ts) work in tests.
    (frag).appendText = vi.fn();
    if (callback) callback(frag);
    return frag;
});
