import { vi } from 'vitest';
/**
 * Mock implementation of Obsidian API for Node.js test environment.
 * This file is aliased in vitest.config.mts.
 */

export class ItemView {
    contentEl: HTMLElement = {} as HTMLElement;
    icon: string = "";
    constructor(_leaf: any) { }
    getDisplayText(): string { return ""; }
    getViewType(): string { return ""; }
}

export class WorkspaceLeaf { }
export class AbstractInputSuggest<_T = unknown> {
    constructor(_app: App, _inputEl: HTMLInputElement | HTMLTextAreaElement) { }
}

export class MarkdownRenderChild {
    containerEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
    }
    load() {}
    unload() {}
}

export function normalizePath(path: string): string {
    const segments = path.replace(/\\/g, '/').split('/');
    const result: string[] = [];
    for (const segment of segments) {
        if (segment === '..') {
            result.pop();
        } else if (segment !== '.' && segment !== '') {
            result.push(segment);
        }
    }
    return result.join('/');
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
    const [path, subpath] = linktext.split('#');
    return { path: path || "", subpath: subpath || "" };
}

export class TFile {
    basename: string = "";
    extension: string = "";
    path: string = "";
    name: string = "";
    stat = { ctime: 0, mtime: 0, size: 0 };
}
export class TFolder { }
export class App {
    vault: any;
    workspace: any;
    metadataCache: any;
    fileManager: any;
}
export class Plugin {
    app: App = new App();
    manifest: any = {};
    constructor(_app: App, _manifest: any) { }
    addCommand(_cmd: any): void { }
    loadSettings(): Promise<void> { return Promise.resolve(); }
    onload(): Promise<void> | void { }
    onunload(): void { }
    registerView(_type: string, _creator: (leaf: any) => any): void { }
    saveSettings(): Promise<void> { return Promise.resolve(); }
}

export class PluginSettingTab {
    app: App = new App();
    containerEl: HTMLElement = {} as HTMLElement;
    settingItems: unknown[] = [];
    constructor(_app: App, _plugin: Plugin) { }
    display(): void { }
    hide(): void { }
    getSettingDefinitions(): unknown[] { return []; }
    getControlValue(_key: string): unknown { return undefined; }
    setControlValue(_key: string, _value: unknown): void | Promise<void> { }
    refreshDomState(): void { }
    update(): void { }
}

export class SettingGroup {
    listEl: HTMLElement = {} as HTMLElement;
    constructor(_containerEl: HTMLElement) { }
    setHeading(_text: string | DocumentFragment): this { return this; }
    addClass(..._classes: string[]): this { return this; }
    addSetting(_cb: (setting: Setting) => void): this { return this; }
    addSearch(_cb: (component: SearchComponent) => unknown): this { return this; }
    addExtraButton(_cb: (component: ExtraButtonComponent) => unknown): this { return this; }
}

export class SettingPage {
    rootEl: HTMLElement = {} as HTMLElement;
    titlebarEl: HTMLElement = {} as HTMLElement;
    containerEl: HTMLElement = {} as HTMLElement;
    title: string = "";
    constructor() { }
    display(): void { }
    hide(): void { }
}

export class SearchComponent {
    inputEl: HTMLInputElement = {} as HTMLInputElement;
    clearButtonEl: HTMLElement = {} as HTMLElement;
    constructor(_containerEl: HTMLElement) { }
    setValue(_value: string): this { return this; }
    getValue(): string { return ""; }
    setPlaceholder(_placeholder: string): this { return this; }
    onChange(_cb: (value: string) => unknown): this { return this; }
    onSearchChanged(_cb: (value: string) => unknown): this { return this; }
}

export class ExtraButtonComponent {
    extraSettingsEl: HTMLElement = {} as HTMLElement;
    constructor(_containerEl: HTMLElement) { }
    setDisabled(_disabled: boolean): this { return this; }
    setTooltip(_tooltip: string): this { return this; }
    setIcon(_icon: string): this { return this; }
    onClick(_cb: () => unknown): this { return this; }
    setExtraButtonHidden(_hidden: boolean): this { return this; }
}

let mockApiVersion = "1.12.0";
export function requireApiVersion(version: string): boolean {
    // Semver-style comparison: returns true when the mocked Obsidian version
    // is greater than or equal to the requested version.
    // Default to "1.12.0" so tests use the imperative display() path unless
    // a test explicitly raises the mocked version via setMockApiVersion.
    return compareVersions(mockApiVersion, version) >= 0;
}
export function setMockApiVersion(v: string): void { mockApiVersion = v; }
export function getMockApiVersion(): string { return mockApiVersion; }

function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(n => Number.parseInt(n, 10) || 0);
    const pb = b.split(".").map(n => Number.parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da > db) return 1;
        if (da < db) return -1;
    }
    return 0;
}

export class Setting {
    constructor(_containerEl: HTMLElement) { }
    setName(_name: string): this { return this; }
    setDesc(_desc: string): this { return this; }
    addText(_cb: (text: any) => any): this { return this; }
    addToggle(_cb: (toggle: any) => any): this { return this; }
    addButton(_cb: (button: any) => any): this { return this; }
    addDropdown(_cb: (dropdown: any) => any): this { return this; }
    addSlider(_cb: (slider: any) => any): this { return this; }
}

export class Notice {
    constructor(_message: string, _duration?: number) { }
}

export class Modal {
    contentEl: HTMLElement = {} as HTMLElement;
    constructor(_app: App) { }
    open(): void { }
    close(): void { }
    onOpen(): void { }
    onClose(): void { }
}

export class Events {
    on(_event: string, _callback: (...args: any[]) => any): any { return null; }
    off(_event: string, _callback: (...args: any[]) => any): any { return null; }
    trigger(_event: string, ..._args: any[]): void { }
}

export class Menu {
    addItem = vi.fn().mockReturnThis();
    addSeparator = vi.fn().mockReturnThis();
    showAtMouseEvent = vi.fn().mockReturnThis();
    showAtPosition = vi.fn().mockReturnThis();
}


export function createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment {
    const frag = (g as any).document.createDocumentFragment();
    if (callback) callback(frag);
    return frag;
}

export const Platform = {
    isDesktopApp: true,
    isMobile: false
};

// Global mocks for Node environment
const g = globalThis;
if (g) {
    (g as any).self = g;
    (g as any).addEventListener = () => { };
    (g as any).Worker = class {
        onmessage = (_ev: MessageEvent) => { };
        postMessage = (_msg: any) => { };
        terminate = () => { };
    };

    const mockEl = () => ({
        addClass: () => {},
        appendChild: () => {},
        createDiv: mockEl,
        createEl: mockEl,
        createSpan: mockEl,
        remove: () => {},
        setAttribute: () => {},
        style: {}
    });

    (g as any).window = g;
    (g as any).document = {
        body: mockEl(),
        createDiv: mockEl,
        createDocumentFragment: () => ({
            appendChild: () => {},
            createDiv: mockEl,
            createEl: mockEl,
            createSpan: mockEl
        }),
        createEl: mockEl,
        createElement: mockEl,
        createSpan: mockEl
    };

    (g as any).activeDocument = (g as any).document;
    (g as any).activeWindow = g;
    (g as any).activeDocument.win = g;
    (g as any).createFragment = createFragment;

    // Mock getComputedStyle for theme resolution tests
    (g as any).getComputedStyle = () => ({
        color: "rgb(0, 0, 0)",
        getPropertyValue: () => ""
    });

    (g as any).WebGL2RenderingContext = class { };
    (g as any).WebGLRenderingContext = class { };
}