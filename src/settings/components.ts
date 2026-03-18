import type { TextComponent } from "obsidian";

import { DropdownComponent, setIcon } from "obsidian";
import * as Obsidian from "obsidian";

import { ModelDefinition } from "../services/ModelRegistry";

declare module "obsidian" {
    interface TextComponent {
        setPassword(): this;
    }
}

if (Obsidian.TextComponent && (Obsidian.TextComponent as unknown as { prototype: unknown }).prototype) {
    Obsidian.TextComponent.prototype.setPassword = function (this: TextComponent): TextComponent {
        this.inputEl.type = 'password';

        const wrapper = this.inputEl.parentElement;
        if (wrapper) {
            wrapper.setCssProps({ "position": "relative" });
            this.inputEl.setCssProps({ "padding-right": "30px" });
            
            const toggleBtn = wrapper.createSpan({ cls: 'clickable-icon vi-password-toggle' });
            toggleBtn.setCssProps({
                "position": "absolute",
                "right": "5px",
                "top": "50%",
                "transform": "translateY(-50%)",
                "z-index": "10"
            });
            setIcon(toggleBtn, 'eye');

            toggleBtn.addEventListener('click', () => {
                if (this.inputEl.type === 'password') {
                    this.inputEl.type = 'text';
                    setIcon(toggleBtn, 'eye-off');
                } else {
                    this.inputEl.type = 'password';
                    setIcon(toggleBtn, 'eye');
                }
            });
        }

        return this;
    };
}

export function renderModelDropdown(
    dropdown: DropdownComponent,
    models: ModelDefinition[],
    currentValue: string,
    hasProvider: boolean,
    hasOllamaSetting: boolean,
    onSelect: (val: string) => void
): void {
    if (!hasProvider) {
        dropdown.addOption('none', 'Configure provider to enable selection...');
        dropdown.setDisabled(true);
        return;
    }

    const selectEl = dropdown.selectEl;
    selectEl.innerHTML = '';

    const sortGoogleModels = (models: ModelDefinition[]) => {
        const getPriority = (id: string) => {
            if (/^gemini-.*-latest$/.test(id)) return 1;
            if (/^gemini-embedding-/.test(id)) return 2;
            if (/^gemini-/.test(id) && !/^gemini-2\./.test(id)) return 3;
            if (/^gemma-/.test(id)) return 4;
            return 5;
        };

        return [...models].sort((a, b) => {
            const pA = getPriority(a.id);
            const pB = getPriority(b.id);
            if (pA !== pB) return pA - pB;
            return a.label.localeCompare(b.label);
        });
    };

    const googleModels = sortGoogleModels(models.filter(m => m.provider === 'gemini'));
    const ollamaModels = models.filter(m => m.provider === 'ollama');
    const localModels = models.filter(m => m.provider === 'local');

    if (googleModels.length > 0) {
        const group = selectEl.createEl('optgroup', { attr: { label: 'Cloud (Gemini)' } });
        for (const m of googleModels) {
            group.createEl('option', { text: m.label, value: m.id });
        }
    }

    if (ollamaModels.length > 0) {
        const group = selectEl.createEl('optgroup', { attr: { label: 'Local (Ollama)' } });
        for (const m of ollamaModels) {
            group.createEl('option', { text: m.label, value: m.id });
        }
    } else if (hasOllamaSetting) {
        const group = selectEl.createEl('optgroup', { attr: { label: 'Local (Ollama)' } });
        group.createEl('option', {
            attr: { disabled: 'true' },
            text: 'No models found',
            value: 'none'
        });
    }

    if (localModels.length > 0) {
        const group = selectEl.createEl('optgroup', { attr: { label: 'Local (ONNX)' } });
        for (const m of localModels) {
            group.createEl('option', { text: m.label, value: m.id });
        }
    }

    selectEl.createEl('option', { text: 'Custom model ID...', value: 'custom' });

    const isPreset = models.some(m => m.id === currentValue);
    dropdown.setValue(isPreset ? currentValue : 'custom');

    for (let i = 0; i < dropdown.selectEl.options.length; i++) {
        const opt = dropdown.selectEl.options.item(i);
        if (opt && opt.value !== 'custom' && opt.value !== 'none') opt.title = opt.value;
    }

    dropdown.onChange(onSelect);
}
