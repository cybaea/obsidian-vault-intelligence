/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Mocking private methods for unit testing adaptation logic */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking private methods for unit testing adaptation logic */
import { App, Notice } from 'obsidian';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { GeminiProvider } from '../../src/services/GeminiProvider';
import { ModelRegistry } from '../../src/services/ModelRegistry';
import { VaultIntelligenceSettings } from '../../src/settings';

vi.mock('obsidian', () => {
    return {
        App: vi.fn(),
        Notice: vi.fn(),
    };
});

describe('GeminiProvider', () => {
    let service: GeminiProvider;
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;
    let mockGetSecret: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            geminiRetries: 1,
            googleApiKey: '',
            secretStorageFailure: false,
        } as unknown as VaultIntelligenceSettings;

        mockGetSecret = vi.fn();

        mockApp = {
            secretStorage: {
                deleteSecret: vi.fn(),
                getSecret: mockGetSecret,
                hasSecret: vi.fn(),
                setSecret: vi.fn(),
            },
        } as unknown as App;

        service = new GeminiProvider(mockSettings, mockApp);
    });

    describe('getApiKey', () => {
        it('should return null if no key is stored', async () => {
            mockSettings.googleApiKey = '';
            const key = await service.getApiKey();
            expect(key).toBeNull();
        });

        it('should return raw key if it starts with AIza', async () => {
            mockSettings.googleApiKey = 'AIzaSyD-TestKey123';
            const key = await service.getApiKey();
            expect(key).toBe('AIzaSyD-TestKey123');
            expect(mockGetSecret).not.toHaveBeenCalled();
        });

        it('should return raw key if secretStorageFailure is true', async () => {
            mockSettings.googleApiKey = 'some-key';
            mockSettings.secretStorageFailure = true;
            const key = await service.getApiKey();
            expect(key).toBe('some-key');
            expect(mockGetSecret).not.toHaveBeenCalled();
        });

        it('should call secretStorage.getSecret for the default secret ID', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockReturnValue('secret-from-storage');

            const key = await service.getApiKey();

            expect(mockGetSecret).toHaveBeenCalledWith('vault-intelligence-api-key');
            expect(key).toBe('secret-from-storage');
        });

        it('should call secretStorage.getSecret for custom secret IDs', async () => {
            mockSettings.googleApiKey = 'my-custom-secret-id';
            mockGetSecret.mockReturnValue('custom-secret-value');

            const key = await service.getApiKey();

            expect(mockGetSecret).toHaveBeenCalledWith('my-custom-secret-id');
            expect(key).toBe('custom-secret-value');
        });

        it('should return null if secretStorage throws an error', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockImplementation(() => {
                throw new Error('Access denied');
            });

            const key = await service.getApiKey();

            expect(key).toBeNull();
        });
    });

    describe('getClient UX Polish', () => {
        it('should show a Notice if API key is missing from storage but secret ID exists', async () => {
            mockSettings.googleApiKey = 'vault-intelligence-api-key';
            mockGetSecret.mockReturnValue(null);

            // Trigger getClient
            await service.generateMessage([{ content: 'test', role: 'user' }], {}).catch(() => { });

            expect(Notice).toHaveBeenCalledWith(expect.stringContaining("keychain"));
        });

        it('should NOT show a Notice if API key is simply missing (empty settings)', async () => {
            mockSettings.googleApiKey = '';

            await service.generateMessage([{ content: 'test', role: 'user' }], {}).catch(() => { });

            expect(Notice).not.toHaveBeenCalled();
        });

        it('should NOT show a Notice if using a raw AIza key', async () => {
            mockSettings.googleApiKey = 'AIzaRawKey';

            await service.generateMessage([{ content: 'test', role: 'user' }], {}).catch(() => { });

            expect(Notice).not.toHaveBeenCalled();
        });
    });

    describe('SDK Payload Injection (generateMessage)', () => {
        let mockGenerateContent: Mock;

        beforeEach(() => {
            mockGenerateContent = vi.fn().mockResolvedValue({ 
                candidates: [{ content: { parts: [{ text: 'mock response' }] } }],
                text: 'mock response' 
            });
            const mockClient = { models: { generateContent: mockGenerateContent } };
            vi.spyOn(service as any, 'getClient').mockResolvedValue(mockClient);
            // We need a dummy model in the registry that supports native search to test this
            vi.spyOn(ModelRegistry, 'getModelById').mockImplementation((id: string) => {
                if (id === 'gemini-native-search') return { supportsNativeSearch: true } as unknown as ReturnType<typeof ModelRegistry.getModelById>;
                if (id === 'gemini-no-search') return { supportsNativeSearch: false } as unknown as ReturnType<typeof ModelRegistry.getModelById>;
                return undefined;
            });
            // We also need parseResponse to not fail, which it shouldn't for simple texts
        });

        it('should inject googleSearch when enabled explicitly in ChatOptions', async () => {
            await service.generateMessage([{ content: 'test', role: 'user' }], {
                enableWebSearch: true,
                modelId: 'gemini-native-search',
            });

            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            const requestParams = mockGenerateContent.mock.calls[0]![0];
            
            // Check tools array for both injected objects
            expect(requestParams.tools).toBeDefined();
            expect(requestParams.tools).toContainEqual({ googleSearch: {} });
        });

        it('should NOT inject googleSearch if the model does not support it, even if enabled', async () => {
            await service.generateMessage([{ content: 'test', role: 'user' }], {
                enableWebSearch: true,
                modelId: 'gemini-no-search',
            });

            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            const requestParams = mockGenerateContent.mock.calls[0]![0];
            
            expect(requestParams.tools ?? []).not.toContainEqual({ googleSearch: {} });
        });

        it('should NOT inject googleSearch if disabled in ChatOptions', async () => {
            await service.generateMessage([{ content: 'test', role: 'user' }], {
                enableWebSearch: false,
                modelId: 'gemini-native-search',
            });

            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            const requestParams = mockGenerateContent.mock.calls[0]![0];
            
            expect(requestParams.tools).toBeUndefined();
        });

        it('should fallback to settings if options are undefined', async () => {
            mockSettings.enableWebSearch = true;
            
            await service.generateMessage([{ content: 'test', role: 'user' }], {
                modelId: 'gemini-native-search',
            });

            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            const requestParams = mockGenerateContent.mock.calls[0]![0];
            
            expect(requestParams.tools).toContainEqual({ googleSearch: {} });
        });
    });

    describe('Translation Logic (private methods)', () => {
        it('should correctly merge consecutive roles in formatHistory', () => {
            const history: any[] = [
                { content: 'hello', role: 'user' },
                { content: 'world', role: 'user' },
                { content: 'thinking', role: 'model' }
            ];
            
            const formatted = (service as any).formatHistory(history);
            
            expect(formatted).toHaveLength(2);
            expect(formatted[0].role).toBe('user');
            expect(formatted[0].parts).toHaveLength(2);
            expect(formatted[0].parts[0].text).toBe('hello');
            expect(formatted[0].parts[1].text).toBe('world');
            expect(formatted[1].role).toBe('model');
        });

        it('should translate tool calls and responses correctly with thought_signatures', () => {
             const history: any[] = [
                { 
                    content: '', 
                    role: 'model', 
                    toolCalls: [{ args: { a: 1 }, name: 'test_tool', thought_signature: 'sig_123' }] 
                },
                { 
                    content: '', 
                    role: 'tool', 
                    toolResults: [{ id: '123', name: 'test_tool', result: { result: 'ok' }, thought_signature: 'sig_123' }] 
                } 
            ];
            
            const formatted = (service as any).formatHistory(history);
            
            expect(formatted).toHaveLength(2);
            // Model turn
            expect(formatted[0].role).toBe('model');
            // Check sibling placement
            expect(formatted[0].parts[0].functionCall).toEqual({ 
                args: { a: 1 }, 
                name: 'test_tool'
            });
            expect(formatted[0].parts[0].thought_signature).toBe('sig_123');
            
            // Tool turn (response) - note: signature is NOT in result part, but kept in internal state
            expect(formatted[1].role).toBe('user');
            expect(formatted[1].parts[0].functionResponse).toEqual({ 
                name: 'test_tool', 
                response: { result: 'ok' }
            });
        });

        it('should capture thought_signature from sibling Part in parseResponse', () => {
             const mockResponse: any = {
                candidates: [{
                    content: {
                        parts: [{
                            functionCall: {
                                args: { q: 'test' },
                                name: 'search_tool'
                            },
                            thought_signature: 'encoded_thought_metadata'
                        }]
                    }
                }],
                text: ''
            };
            
            const parsed = (service as any).parseResponse(mockResponse);
            
            expect(parsed.toolCalls).toHaveLength(1);
            expect(parsed.toolCalls[0].name).toBe('search_tool');
            expect(parsed.toolCalls[0].thought_signature).toBe('encoded_thought_metadata');
        });

        it('should format tools correctly for the SDK', () => {
            const tools: any[] = [{
                description: 'A tool',
                name: 'my_tool',
                parameters: { properties: { x: { type: 'number' } }, type: 'object' }
            }];
            
            const formatted = (service as any).formatTools(tools);
            expect(formatted).toHaveLength(1);
            expect(formatted[0].name).toBe('my_tool');
            expect(formatted[0].parameters).toEqual(tools[0].parameters);
        });
    });
});

/* eslint-enable @typescript-eslint/no-explicit-any -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- End of mock-heavy test section */
/* eslint-enable @typescript-eslint/no-unsafe-call -- End of mock-heavy test section */
