import { requestUrl, type Setting } from 'obsidian';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { configureOllamaEndpointField, configureOpenAICompatEndpointField } from '../../src/settings/sections/connections';
import { SettingsTabContext } from '../../src/settings/SettingsTabContext';
import { IVaultIntelligencePlugin, VaultIntelligenceSettings } from '../../src/settings/types';
import { MockSetting } from '../helpers/MockSetting';

// The shared obsidian mock's requestUrl always resolves a 200 response, which
// cannot exercise the probe status branches; replace it with a controllable
// vi.fn() while keeping the rest of the mock module intact.
vi.mock('obsidian', async (importOriginal) => {
    const original = await importOriginal<typeof import('../mocks/obsidian')>();
    return {
        ...original,
        requestUrl: vi.fn().mockResolvedValue({ json: {}, status: 200, text: '' })
    };
});

interface StatusBadge {
    className: string;
    setText: Mock;
}

const context = {} as unknown as SettingsTabContext;

function makePlugin(settings: Partial<VaultIntelligenceSettings>): IVaultIntelligencePlugin {
    return {
        app: {
            secretStorage: { getSecret: vi.fn().mockResolvedValue('token123') }
        },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        settings: settings as VaultIntelligenceSettings
    } as unknown as IVaultIntelligencePlugin;
}

function configureAndCapture(render: (setting: Setting) => void): { badge: StatusBadge; setting: MockSetting } {
    const setting = new MockSetting();
    render(setting as unknown as Setting);
    const createDiv = setting.controlEl.createDiv as unknown as Mock;
    return { badge: createDiv.mock.results[0]?.value as StatusBadge, setting };
}

describe('connection endpoint probes (Test connection)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Ollama endpoint', () => {
        it('should probe /api/version with throw: false and show Online on 200', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 200 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Online');
            expect(badge.className).toBe('vi-ollama-status vi-status-success');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                throw: false,
                url: 'http://localhost:11434/api/version'
            }));
        });

        it('should show Offline for non-200 probe responses (e.g. a 401) via the status branch', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 401 });

            const { badge, setting } = configureAndCapture((captured) => {
                // Trailing slash is stripped by the probe, not the request URL.
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434/' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Offline');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                throw: false,
                url: 'http://localhost:11434/api/version'
            }));
        });

        it('should show Offline when the probe rejects (transport failure)', async () => {
            (requestUrl as Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Offline');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
        });
    });

    describe('OpenAI-compatible endpoint', () => {
        it('should resolve header secrets, probe /models with throw: false, and show Online on 200', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 200 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({
                    openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
                    openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:stored-token' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Online');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'token123' }),
                throw: false,
                url: 'https://ai-gateway.kilo.ai/api/v1/models'
            }));
        });

        it('should show Offline for a 401 through the status branch, not the catch', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 401 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({
                    openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
                    openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:stored-token' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Offline');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should show Offline when the probe rejects (transport failure)', async () => {
            (requestUrl as Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({
                    openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
                    openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:stored-token' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Offline');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
        });
    });
});