import { Notice } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import type { IVaultIntelligencePlugin } from '../../src/settings/types';

import { CONNECTION_PRESETS } from '../../src/constants';
import { applyConnectionPreset, withAuthorizationSecret } from '../../src/settings/sections/connections';

// The Notices the presets now emit are part of the preset contract: replace
// the shared obsidian mock's inert class with a callable spy.
vi.mock('obsidian', async (importOriginal) => {
    const original = await importOriginal<typeof import('../mocks/obsidian')>();
    return {
        ...original,
        Notice: Object.assign(vi.fn(), original.Notice)
    };
});

describe('connection presets', () => {
    describe('withAuthorizationSecret', () => {
        it('should add a bare Authorization secret reference', () => {
            expect(JSON.parse(withAuthorizationSecret(undefined))).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
        });

        it('should preserve existing headers', () => {
            const json = JSON.stringify({ 'X-Custom': 'abc' });
            const parsed = JSON.parse(withAuthorizationSecret(json)) as Record<string, string>;

            expect(parsed['X-Custom']).toBe('abc');
            expect(parsed['Authorization']).toBe('vi-secret:Authorization');
        });

        it('should replace an existing Authorization header', () => {
            const json = JSON.stringify({ Authorization: 'Bearer plain-token' });
            const parsed = JSON.parse(withAuthorizationSecret(json)) as Record<string, string>;

            expect(parsed['Authorization']).toBe('vi-secret:Authorization');
        });

        it('should recover from invalid JSON', () => {
            expect(JSON.parse(withAuthorizationSecret('not json'))).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
        });
    });

    describe('applyConnectionPreset', () => {
        const makePlugin = (): IVaultIntelligencePlugin => {
            const plugin = {
                saveSettings: vi.fn().mockResolvedValue(undefined),
                settings: {} as Record<string, unknown>
            };
            return plugin as unknown as IVaultIntelligencePlugin;
        };

        it('should configure the Kilo preset on the OpenAI-compatible connection', async () => {
            const plugin = makePlugin();

            await applyConnectionPreset('kilo', plugin);

            expect(plugin.settings.openaiCompatEndpoint).toBe(CONNECTION_PRESETS.KILO.ENDPOINT);
            expect(JSON.parse(plugin.settings.openaiCompatHeaders as string)).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should configure the Ollama Cloud preset on the Ollama connection', async () => {
            const plugin = makePlugin();

            await applyConnectionPreset('ollama-cloud', plugin);

            expect(plugin.settings.ollamaEndpoint).toBe(CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT);
            expect(JSON.parse(plugin.settings.ollamaHeaders as string)).toEqual({
                Authorization: 'vi-secret:Authorization'
            });
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should configure the local Ollama preset without touching headers', async () => {
            const plugin = makePlugin();

            await applyConnectionPreset('ollama-local', plugin);

            expect(plugin.settings.ollamaEndpoint).toBe(CONNECTION_PRESETS.OLLAMA_LOCAL.ENDPOINT);
            expect(plugin.settings.ollamaHeaders).toBeUndefined();
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should do nothing for unknown preset values', async () => {
            const plugin = makePlugin();

            await applyConnectionPreset('none', plugin);

            expect(plugin.settings).toEqual({});
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should announce the set endpoint and the field to fill for the Kilo preset', async () => {
            await applyConnectionPreset('kilo', makePlugin());

            expect(Notice).toHaveBeenCalledWith(expect.stringContaining(CONNECTION_PRESETS.KILO.ENDPOINT));
            expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Kilo API key'));
        });

        it('should announce the set endpoint and the field to fill for the Ollama Cloud preset', async () => {
            await applyConnectionPreset('ollama-cloud', makePlugin());

            expect(Notice).toHaveBeenCalledWith(expect.stringContaining(CONNECTION_PRESETS.OLLAMA_CLOUD.ENDPOINT));
            expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Ollama Cloud API key'));
        });

        it('should announce the set endpoint for the local Ollama preset', async () => {
            await applyConnectionPreset('ollama-local', makePlugin());

            expect(Notice).toHaveBeenCalledWith(expect.stringContaining(CONNECTION_PRESETS.OLLAMA_LOCAL.ENDPOINT));
        });

        it('should not announce anything for unknown preset values', async () => {
            await applyConnectionPreset('none', makePlugin());

            expect(Notice).not.toHaveBeenCalled();
        });
    });
});
