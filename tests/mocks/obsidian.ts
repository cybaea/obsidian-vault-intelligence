/* eslint-disable eslint-comments/disable-enable-pair -- Mock file does not require enable pairs */
/* eslint-disable eslint-comments/require-description -- Descriptions not required for comprehensive mock disable */
/* eslint-disable */
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
export class AbstractInputSuggest<T> {
    constructor(_app: App, _inputEl: HTMLInputElement | HTMLTextAreaElement) { }
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

export class TFile {
    basename: string = "";
    extension: string = "";
    path: string = "";
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
    constructor(_app: App, _plugin: Plugin) { }
    display(): void { }
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

export class Events {
    on(_event: string, _callback: (...args: any[]) => any): any { return null; }
    trigger(_event: string, ..._args: any[]): void { }
}

export const Platform = {
    isMobile: false
};

// Global mocks for Node environment
const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : window);
if (g) {
    (g as any).self = g;
    (g as any).addEventListener = () => { };
    (g as any).Worker = class {
        onmessage = (_ev: MessageEvent) => { };
        postMessage = (_msg: any) => { };
        terminate = () => { };
    };

    (g as any).window = {
        cancelAnimationFrame: (id: number) => clearTimeout(id),
        requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0)
    };

    (g as any).document = {
        createElement: (tag: string) => ({})
    };
}
