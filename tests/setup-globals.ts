/* eslint-disable eslint-comments/disable-enable-pair -- Setup file doesn't need pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking global objects for tests requires any access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking global objects for tests requires any access */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking global objects for tests requires any access */
/* eslint-disable @typescript-eslint/no-unsafe-return -- Mocking global objects for tests requires any access */
import { vi } from 'vitest';

const g = globalThis as any;

const mockEl = (): any => ({
    addClass: vi.fn(),
    appendChild: vi.fn(),
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
        appendChild: vi.fn(),
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
