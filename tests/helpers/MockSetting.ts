import { type Mock, vi } from 'vitest';

/**
 * A mock Obsidian `Setting`-like object that captures method calls and
 * exposes `onChange`/`onClick` callbacks so behavioural tests can fire
 * them and assert on side-effects (settings mutations, saveSettings calls,
 * flag assignments).
 *
 * The mock provides the DOM-bearing properties (`controlEl`, `settingEl`,
 * `descEl`, etc.) as recursive mock elements so render closures that build
 * DOM into those slots (e.g. the D7 Ollama status badge) do not throw.
 */

function mockEl(): any {
    return {
        addClass: vi.fn(),
        appendChild: vi.fn(),
        children: [],
        classList: { add: vi.fn(), contains: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
        className: '',
        createDiv: vi.fn().mockImplementation(() => mockEl()),
        createEl: vi.fn().mockImplementation(() => mockEl()),
        createSpan: vi.fn().mockImplementation(() => mockEl()),
        empty: vi.fn(),
        querySelector: vi.fn().mockReturnValue(null),
        remove: vi.fn(),
        setAttr: vi.fn(),
        setAttribute: vi.fn(),
        setText: vi.fn(),
        style: {},
        textContent: '',
        title: '',
    };
}

export class MockSetting {
    readonly name: string | undefined;
    readonly desc: string | DocumentFragment | undefined;
    readonly controlEl: any = mockEl();
    readonly settingEl: any = mockEl();
    readonly descEl: any = mockEl();
    readonly infoEl: any = mockEl();
    readonly nameEl: any = mockEl();
    readonly componentsEl: any = mockEl();

    /**
     * The text-component mock objects from every `addText` call, in call
     * order. Lets behavioural tests assert `setValue` calls (e.g. an endpoint
     * field normalizing itself on blur) and fire registered input listeners.
     */
    readonly textComponents: Array<{
        inputEl: {
            addEventListener: Mock;
        };
        setValue: Mock;
    }> = [];

    /**
     * The button mock objects from every `addButton` call, in call order.
     * Lets behavioural tests assert the `setDisabled` gating (e.g. the
     * refresh button's enablement by configured connection).
     */
    readonly buttonComponents: Array<{
        setDisabled: Mock;
    }> = [];

    private inputEventListeners: Map<string, Array<(ev: unknown) => void>> = new Map();

    private toggleCallback?: (value: boolean) => void | Promise<void>;
    private dropdownCallback?: (value: string) => void | Promise<void>;
    private textCallback?: (value: string) => void | Promise<void>;
    private buttonCallback?: () => void | Promise<void>;
    private component?: { fireChange?: (value: string | null) => Promise<void> };

    /**
     * The raw component captured from `addComponent` (e.g. a SecretComponent
     * mock), if a component was added. Lets tests assert component-level
     * behaviour such as `setValue` seeding.
     */
    get capturedComponent(): unknown {
        return this.component;
    }

    setName(name: string): this {
        (this as any).name = name;
        return this;
    }

    setDesc(desc: string | DocumentFragment): this {
        (this as any).desc = desc;
        return this;
    }

    setTooltip(_tooltip: string): this { return this; }
    setDisabled(_disabled: boolean): this { return this; }
    setClass(_cls: string): this { return this; }
    addClass(_cls: string): this { return this; }
    setHeading(_text?: string | DocumentFragment): this { return this; }

    addToggle(cb: (toggle: { setValue: (v: boolean) => any; onChange: (cb: (v: boolean) => void | Promise<void>) => any }) => void): this {
        const toggle = {
            onChange: (cb: (v: boolean) => void | Promise<void>) => { this.toggleCallback = cb; return toggle; },
            setValue: vi.fn().mockReturnThis(),
        };
        cb(toggle);
        return this;
    }

    addDropdown(cb: (dropdown: {
        addOption: (value: string, label: string) => any;
        onChange: (cb: (v: string) => void | Promise<void>) => any;
        setValue: (v: string) => any;
        setDisabled: (v: boolean) => any;
        selectEl: any;
    }) => void): this {
        const dropdown = {
            addOption: vi.fn().mockReturnThis(),
            onChange: (cb: (v: string) => void | Promise<void>) => { this.dropdownCallback = cb; return dropdown; },
            selectEl: { createEl: vi.fn().mockImplementation(() => mockEl()), innerHTML: '', options: { item: vi.fn(), length: 0 } },
            setDisabled: vi.fn().mockReturnThis(),
            setValue: vi.fn().mockReturnThis(),
        };
        cb(dropdown);
        return this;
    }

    addText(cb: (text: {
        setPlaceholder: (p: string) => any;
        setValue: (v: string) => any;
        onChange: (cb: (v: string) => void | Promise<void>) => any;
        setPassword: () => any;
        inputEl: any;
    }) => void): this {
        let textValue = '';
        const text = {
            getValue: vi.fn((): string => textValue),
            inputEl: {
                addClass: vi.fn(),
                addEventListener: vi.fn().mockImplementation((type: string, listener: (ev: unknown) => void) => {
                    const listeners = this.inputEventListeners.get(type) ?? [];
                    listeners.push(listener);
                    this.inputEventListeners.set(type, listeners);
                }),
                parentElement: mockEl(),
                type: 'text'
            },
            onChange: (cb: (v: string) => void | Promise<void>) => {
                this.textCallback = (v: string) => {
                    textValue = v;
                    return cb(v);
                };
                return text;
            },
            setPassword: vi.fn().mockReturnThis(),
            setPlaceholder: vi.fn().mockReturnThis(),
            setValue: vi.fn((v: string) => {
                textValue = v;
                return text;
            })
        };
        this.textComponents.push(text);
        cb(text);
        return this;
    }

    addButton(cb: (button: {
        setButtonText: (t: string) => any;
        setDisabled: (v: boolean) => any;
        setIcon: (i: string) => any;
        setTooltip: (t: string) => any;
        onClick: (cb: () => void | Promise<void>) => any;
    }) => void): this {
        const button = {
            onClick: (cb: () => void | Promise<void>) => { this.buttonCallback = cb; return button; },
            setButtonText: vi.fn().mockReturnThis(),
            setDisabled: vi.fn().mockReturnThis(),
            setIcon: vi.fn().mockReturnThis(),
            setTooltip: vi.fn().mockReturnThis(),
        };
        this.buttonComponents.push({ setDisabled: button.setDisabled });
        cb(button);
        return this;
    }

    addExtraButton(_cb: (button: any) => void): this { return this; }
    addSlider(_cb: (slider: any) => void): this { return this; }

    /**
     * Mirrors the real `Setting.addComponent`, which invokes the callback to
     * build the component. The returned component is captured so behavioural
     * tests can fire its onChange handler (e.g. SecretComponent on 1.14+).
     */
    addComponent(cb: (el: any) => any): this {
        this.component = cb(mockEl());
        return this;
    }

    async fireToggle(value: boolean): Promise<void> {
        if (this.toggleCallback) await this.toggleCallback(value);
    }

    async fireDropdown(value: string): Promise<void> {
        if (this.dropdownCallback) await this.dropdownCallback(value);
    }

    async fireText(value: string): Promise<void> {
        if (this.textCallback) await this.textCallback(value);
    }

    /**
     * Fires a DOM event registered on the most recently added text input
     * (e.g. `blur`, used by the endpoint fields to normalize the URL).
     */
    async fireTextEvent(type: string): Promise<void> {
        for (const listener of this.inputEventListeners.get(type) ?? []) {
            await Promise.resolve(listener({}));
        }
    }

    async fireButton(): Promise<void> {
        if (this.buttonCallback) await this.buttonCallback();
    }

    async fireSecretChange(value: string | null): Promise<void> {
        if (this.component?.fireChange) await this.component.fireChange(value);
    }
}