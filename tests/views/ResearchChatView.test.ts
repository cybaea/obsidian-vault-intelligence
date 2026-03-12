/* eslint-disable -- This file uses deep mocks that are incompatible with production lint rules */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    // Initialize globals BEFORE any imports that might trigger side-effects
    Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis, writable: true });
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => { }, writable: true });
    
    // Mock navigator
    const mockNavigator = {
        clipboard: {
            writeText: () => Promise.resolve()
        }
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockNavigator, writable: true });

    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: class {
            onmessage = () => { };
            postMessage = () => { };
            terminate = () => { };
        },
        writable: true
    });

    const mockWindow = {
        cancelAnimationFrame: (id: number) => clearTimeout(id),
        requestAnimationFrame: (cb: any) => setTimeout(() => cb(), 0)
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow, writable: true });

    const mockDocument = {
        createElement: () => ({})
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDocument, writable: true });
});

import { MarkdownRenderer } from 'obsidian';

import { ResearchChatView } from '../../src/views/ResearchChatView';

// Basic mock for Obsidian elements
class MockElement {
    className = '';
    innerHTML = '';
    innerText = '';
    style = { whiteSpace: '' };
    children: MockElement[] = [];
    lastElementChild: MockElement | null = null;
    
    addClass(cls: string) {
        if (!this.className.includes(cls)) {
            this.className = this.className ? `${this.className} ${cls}` : cls;
        }
    }
    addEventListener() {}
    appendChild(el: any) {
        this.children.push(el);
        this.lastElementChild = el;
    }

    createDiv(options?: { cls?: string }) {
        const div = new MockElement();
        if (options?.cls) div.className = options.cls;
        this.children.push(div);
        this.lastElementChild = div;
        return div;
    }
    
    createEl(tag: string, options?: { cls?: string; text?: string }) {
        const el = new MockElement();
        if (options?.cls) el.className = options.cls;
        if (options?.text) el.innerText = options.text;
        this.children.push(el);
        this.lastElementChild = el;
        return el;
    }

    createSpan(options?: { cls?: string; text?: string }) {
        return this.createEl('span', options);
    }

    empty() {
        this.children = [];
        this.lastElementChild = null;
    }

    hide() {}

    querySelector(selector: string) {
        if (selector === '.chat-content') {
            return this.children.find(c => c.className.includes('chat-content')) || null;
        }
        return null;
    }

    setText(text: string) {
        this.innerText = text;
        return this;
    }

    show() {}
}

const mockChatContainer = new MockElement();

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        ButtonComponent: class {
            buttonEl = new MockElement();
            onClick() { return this; }
            setButtonText() { return this; }
            setCta() { return this; }
            setIcon() { return this; }
            setTooltip() { return this; }
        },
        DropdownComponent: class {
            selectEl = new MockElement();
            addOption() { return this; }
            setValue() { return this; }
        },
        MarkdownRenderer: {
            render: vi.fn().mockImplementation((_app, text, el) => {
                if (el.setText) el.setText(text);
                else el.innerText = text;
                return Promise.resolve();
            })
        },
        TextAreaComponent: class {
            inputEl = new MockElement();
            getValue() { return 'test prompt'; }
            setPlaceholder() { return this; }
            setValue() {}
        },
        VIEW_TYPES: { RESEARCH_CHAT: 'research-chat' },
        setIcon: vi.fn()
    };
});

// Mock dependencies
const mockPlugin = {
    app: {
        vault: { getAbstractFileByPath: vi.fn() },
        workspace: { getLeaf: vi.fn() }
    },
    settings: { chatModel: 'gemini-pro', enableCodeExecution: true }
} as any;

const mockReasoningClient = {} as any;
const mockProvider = {} as any;
const mockGraphService = {
    off: vi.fn(),
    on: vi.fn(),
    trigger: vi.fn()
} as any;
const mockEmbeddingService = {} as any;

describe('ResearchChatView Rendering', () => {
    let view: ResearchChatView;

    beforeEach(() => {
        vi.clearAllMocks();
        view = new ResearchChatView(
            {} as any,
            mockPlugin,
            mockReasoningClient,
            mockProvider,
            mockGraphService,
            mockEmbeddingService
        );
        // Manually setup container
        view.chatContainer = mockChatContainer as any;
        (view as any).inputComponent = { getValue: () => 'test prompt', setValue: vi.fn() };
    });

    it('should only call MarkdownRenderer once when stream completes', async () => {
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { text: 'Hello' };
            yield { text: ' world' };
            yield { isDone: true };
        })();

        view.agent.chatStream = vi.fn().mockReturnValue(mockStream);
        view.agent.prepareContext = vi.fn().mockResolvedValue({ cleanMessage: 'test prompt', contextFiles: [] });
        view.agent.reflexSearch = vi.fn().mockResolvedValue([]);

        await (view as any).handleSubmit();

        const render = MarkdownRenderer.render;
        const renderCalls = (render as any).mock.calls;
        const modelRender = renderCalls.find((call: any) => call[1] === 'Hello world');
        expect(modelRender).toBeDefined();
        
        const partialRender = renderCalls.find((call: any) => call[1] === 'Hello');
        expect(partialRender).toBeUndefined();
    });

    it('should update DOM in-place during streaming', async () => {
        const mockStream = (async function* () {
            await Promise.resolve();
            yield { text: 'Part 1' };
            yield { text: ' Part 2' };
            yield { isDone: true };
        })();

        view.agent.chatStream = vi.fn().mockReturnValue(mockStream);
        view.agent.prepareContext = vi.fn().mockResolvedValue({ cleanMessage: 'test', contextFiles: [] });
        view.agent.reflexSearch = vi.fn().mockResolvedValue([]);

        await (view as any).handleSubmit();

        const lastChild = mockChatContainer.lastElementChild;
        const contentEl = lastChild?.querySelector('.chat-content');
        expect(contentEl?.innerText).toBe('Part 1 Part 2');
    });
});
/* eslint-enable */
