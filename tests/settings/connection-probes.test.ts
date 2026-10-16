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
        it('should probe /api/version with throw: false, resolved headers, and show Online on 200', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 200 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Online');
            expect(badge.className).toBe('vi-ollama-status vi-status-success');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: {},
                throw: false,
                url: 'http://localhost:11434/api/version'
            }));
        });

        it('should send the resolved connection headers with the probe (Ollama Cloud Bearer)', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 200 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({
                    ollamaEndpoint: 'https://ollama.com',
                    ollamaHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Online');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: { Authorization: 'token123' }
            }));
        });

        it('should show Unauthorized for a 401 probe response instead of Offline', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 401 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Unauthorized (check your API key)');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                throw: false,
                url: 'http://localhost:11434/api/version'
            }));
        });

        it('should show Unauthorized for a 403 probe response', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 403 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: 'http://localhost:11434' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Unauthorized (check your API key)');
        });

        it('should show Offline for other non-200 probe responses (e.g. a 503) via the status branch', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 503 });

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

        it('should clear the status badge and skip the probe when the endpoint is empty', async () => {
            (requestUrl as Mock).mockClear();

            const { badge, setting } = configureAndCapture((captured) => {
                configureOllamaEndpointField(captured, makePlugin({ ollamaEndpoint: '' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('');
            expect(requestUrl).not.toHaveBeenCalled();
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

        it('should show Unauthorized for a 401 through the status branch, not the catch', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 401 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({
                    openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
                    openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:stored-token' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Unauthorized (check your API key)');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        });

        it('should probe unauthenticated (and show Unauthorized) when a stored secret is missing, not Offline', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 401 });
            // The preset has planted the Authorization reference, but the key
            // was never (or no longer) in the keychain: the probe must not
            // collapse the missing credential into a transport-style Offline.
            const plugin = makePlugin({
                openaiCompatEndpoint: 'https://ai-gateway.kilo.ai/api/v1',
                openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:Authorization' })
            });
            (plugin.app.secretStorage.getSecret as Mock).mockResolvedValue(null);

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, plugin, context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Unauthorized (check your API key)');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                headers: {},
                url: 'https://ai-gateway.kilo.ai/api/v1/models'
            }));
        });

        it('should show Offline for other non-200 responses (e.g. a 404 for a wrong base path)', async () => {
            (requestUrl as Mock).mockResolvedValue({ status: 404 });

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({
                    openaiCompatEndpoint: 'https://ai-gateway.kilo.ai',
                    openaiCompatHeaders: JSON.stringify({ Authorization: 'vi-secret:stored-token' })
                }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('Offline');
            expect(badge.className).toBe('vi-ollama-status vi-status-error');
        });

        it('should clear the status badge and skip the probe when the endpoint is empty', async () => {
            (requestUrl as Mock).mockClear();

            const { badge, setting } = configureAndCapture((captured) => {
                configureOpenAICompatEndpointField(captured, makePlugin({ openaiCompatEndpoint: '' }), context);
            });
            await setting.fireButton();

            expect(badge.setText).toHaveBeenCalledWith('');
            expect(requestUrl).not.toHaveBeenCalled();
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