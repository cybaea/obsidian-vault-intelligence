import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    InvalidationTokenScope,
    OAuthTokenStore,
    PersistedOAuthTokens,
} from '../../../../src/services/mcp/oauth/OAuthTokenStore';
import { ObsidianOAuthClientProvider } from '../../../../src/services/mcp/oauth/ObsidianOAuthClientProvider';

// Stub the logger so info calls during saveDiscoveryState do not spam the
// test console.
vi.mock('../../../../src/utils/logger', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

/**
 * Minimal in-memory stub store implementing the {@link OAuthTokenStore}
 * contract. Methods are typed as `any`-free mock spies so the test can assert
 * on call arguments while satisfying the project's strict production type
 * policy (test files get `any`/unsafe relief per `eslint.config.mts`).
 */
interface StubStore extends OAuthTokenStore {
    invalidate: Mock;
    loadClientInformation: Mock;
    loadClientSecret: Mock;
    loadDiscoveryState: Mock;
    loadTokens: Mock;
    loadVerifier: Mock;
    saveClientInformation: Mock;
    saveClientSecret: Mock;
    saveDiscoveryState: Mock;
    saveTokens: Mock;
    saveVerifier: Mock;
}

function makeStubStore(): StubStore {
    const tokens = new Map<string, PersistedOAuthTokens>();
    const verifier = new Map<string, string>();
    const clientInfo = new Map<string, object>();
    const clientSecret = new Map<string, string>();
    const discovery = new Map<string, object>();

    return {
        invalidate: vi.fn(async (serverId: string, _scope: InvalidationTokenScope) => {
            tokens.delete(serverId);
            verifier.delete(serverId);
            clientInfo.delete(serverId);
            clientSecret.delete(serverId);
            discovery.delete(serverId);
        }),
        loadClientInformation: vi.fn(async (serverId: string) => clientInfo.get(serverId)),
        loadClientSecret: vi.fn(async (serverId: string) => clientSecret.get(serverId)),
        loadDiscoveryState: vi.fn(async (serverId: string) => discovery.get(serverId)),
        loadTokens: vi.fn(async (serverId: string) => tokens.get(serverId)),
        loadVerifier: vi.fn(async (serverId: string) => verifier.get(serverId)),
        saveClientInformation: vi.fn(async (serverId: string, info: object) => {
            clientInfo.set(serverId, info);
        }),
        saveClientSecret: vi.fn(async (serverId: string, secret: string) => {
            clientSecret.set(serverId, secret);
        }),
        saveDiscoveryState: vi.fn(async (serverId: string, state: object) => {
            discovery.set(serverId, state);
        }),
        saveTokens: vi.fn(async (serverId: string, t: PersistedOAuthTokens) => {
            tokens.set(serverId, t);
        }),
        saveVerifier: vi.fn(async (serverId: string, v: string) => {
            verifier.set(serverId, v);
        }),
    };
}

const SERVER_ID = 'srv-prov-1';

describe('ObsidianOAuthClientProvider', () => {
    let store: StubStore;
    let provider: ObsidianOAuthClientProvider;
    let openSpy: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        store = makeStubStore();
        provider = new ObsidianOAuthClientProvider(SERVER_ID, store);

        openSpy = vi.fn();
        // `window` is the global in the vitest node environment. Cast through
        // `unknown` first because the real `window` type's `open` signature is
        // not assignable to `Mock` (test files get `any`/unsafe relief, but
        // `no-unnecessary-type-assertion` still rejects a direct assertion).
        (globalThis as unknown as { window: { open: typeof openSpy } }).window = {
            open: openSpy,
        };
    });

    describe('redirectUrl', () => {
        it('returns undefined before setRedirectUrl is called', () => {
            expect(provider.redirectUrl).toBeUndefined();
        });

        it('returns the value set via setRedirectUrl', () => {
            provider.setRedirectUrl('http://127.0.0.1:54321/callback');
            expect(provider.redirectUrl).toBe('http://127.0.0.1:54321/callback');
        });
    });

    describe('clientMetadata', () => {
        it('exposes the client name and PKCE grant types', () => {
            const meta = provider.clientMetadata;
            expect(meta.client_name).toBe('vault-intelligence');
            expect(meta.grant_types).toEqual(['authorization_code', 'refresh_token']);
            expect(meta.response_types).toEqual(['code']);
            expect(meta.token_endpoint_auth_method).toBe('none');
        });

        it('advertises an empty redirect_uris array when no redirectUrl is set', () => {
            expect(provider.clientMetadata.redirect_uris).toEqual([]);
        });

        it('includes the loopback redirect URL in redirect_uris once set', () => {
            provider.setRedirectUrl('http://127.0.0.1:9999/callback');
            expect(provider.clientMetadata.redirect_uris).toEqual(['http://127.0.0.1:9999/callback']);
        });
    });

    describe('clientInformation', () => {
        it('returns undefined when the store has no client info', async () => {
            expect(await provider.clientInformation()).toBeUndefined();
        });

        it('returns the stored client info unchanged when no secret is stored', async () => {
            const info = { client_id: 'cid-1' };
            store.loadClientInformation.mockResolvedValueOnce(info);
            store.loadClientSecret.mockResolvedValueOnce(undefined);
            expect(await provider.clientInformation()).toEqual(info);
        });

        it('merges the client secret from separate storage', async () => {
            const info = { client_id: 'cid-1' };
            store.loadClientInformation.mockResolvedValueOnce(info);
            store.loadClientSecret.mockResolvedValueOnce('the-secret');
            const loaded = await provider.clientInformation();
            expect(loaded).toEqual({ ...info, client_secret: 'the-secret' });
        });

        it('saveClientInformation delegates to the store and saves the secret separately', async () => {
            await provider.saveClientInformation({ client_id: 'cid-2', client_secret: 'sec' });
            expect(store.saveClientInformation).toHaveBeenCalledTimes(1);
            expect(store.saveClientSecret).toHaveBeenCalledWith(SERVER_ID, 'sec');
        });

        it('saveClientInformation does not save a secret when none is present', async () => {
            await provider.saveClientInformation({ client_id: 'cid-3' });
            expect(store.saveClientSecret).not.toHaveBeenCalled();
        });
    });

    describe('tokens', () => {
        it('returns undefined when no tokens are stored', async () => {
            expect(await provider.tokens()).toBeUndefined();
        });

        it('reconstructs a relative expires_in from expires_at', async () => {
            const now = 1_700_000_000_000;
            const realNow = Date.now;
            Date.now = () => now;

            try {
                store.loadTokens.mockResolvedValueOnce({
                    access_token: 'a',
                    expires_at: now + 60_000, // 60 seconds remaining
                    expires_in: 3600,
                    refresh_token: 'r',
                    token_type: 'Bearer',
                });

                const tokens = await provider.tokens();
                expect(tokens).toBeDefined();
                expect(tokens?.access_token).toBe('a');
                expect(tokens?.expires_in).toBe(60);
                expect(tokens?.refresh_token).toBe('r');
            } finally {
                Date.now = realNow;
            }
        });

        it('clamps expires_in to zero when the token has expired', async () => {
            const now = 1_700_000_000_000;
            const realNow = Date.now;
            Date.now = () => now;

            try {
                store.loadTokens.mockResolvedValueOnce({
                    access_token: 'a',
                    expires_at: now - 1000, // already expired
                    expires_in: 3600,
                    token_type: 'Bearer',
                });

                const tokens = await provider.tokens();
                expect(tokens?.expires_in).toBe(0);
            } finally {
                Date.now = realNow;
            }
        });

        it('returns a very large expires_in for non-expiring tokens (Infinity)', async () => {
            store.loadTokens.mockResolvedValueOnce({
                access_token: 'a',
                expires_at: Number.POSITIVE_INFINITY,
                token_type: 'Bearer',
            });
            const tokens = await provider.tokens();
            expect(tokens?.expires_in).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('forwards token fields to saveTokens on save', async () => {
            await provider.saveTokens({ access_token: 'a', expires_in: 60, token_type: 'Bearer' });
            expect(store.saveTokens).toHaveBeenCalledTimes(1);
            const call = store.saveTokens.mock.calls[0];
            const [id, tokens] = call ?? [];
            expect(id).toBe(SERVER_ID);
            expect(tokens).toEqual({ access_token: 'a', expires_in: 60, token_type: 'Bearer' });
        });
    });

    describe('redirectToAuthorization', () => {
        it('opens the authorization URL in a new browser tab and resolves void', async () => {
            const url = new URL('https://auth.example.com/authorize?client_id=cid');
            await provider.redirectToAuthorization(url);
            expect(openSpy).toHaveBeenCalledTimes(1);
            expect(openSpy).toHaveBeenCalledWith(url.toString(), '_blank');
        });
    });

    describe('codeVerifier', () => {
        it('saves and loads the verifier through the store', async () => {
            store.loadVerifier.mockResolvedValueOnce('v-123');
            await provider.saveCodeVerifier('v-123');
            expect(store.saveVerifier).toHaveBeenCalledWith(SERVER_ID, 'v-123');
            expect(await provider.codeVerifier()).toBe('v-123');
        });

        it('throws when no verifier is stored', async () => {
            store.loadVerifier.mockResolvedValueOnce(undefined);
            await expect(provider.codeVerifier()).rejects.toThrow(/Missing PKCE code verifier/);
        });
    });

    describe('state', () => {
        it('returns a 32-character lowercase hex string', async () => {
            const state = await provider.state();
            expect(state).toMatch(/^[0-9a-f]{32}$/);
        });

        it('returns distinct values across calls', async () => {
            const a = await provider.state();
            const b = await provider.state();
            expect(a).not.toBe(b);
        });
    });

    describe('invalidateCredentials', () => {
        it('delegates to the store with the server id and scope', async () => {
            await provider.invalidateCredentials('all');
            expect(store.invalidate).toHaveBeenCalledWith(SERVER_ID, 'all');
        });
    });

    describe('discovery state', () => {
        it('saves and loads discovery state through the store', async () => {
            const state = {
                authorizationServerUrl: 'https://auth.example.com',
            };
            store.loadDiscoveryState.mockResolvedValueOnce(state);
            await provider.saveDiscoveryState(state);
            expect(store.saveDiscoveryState).toHaveBeenCalledWith(SERVER_ID, state);
            expect(await provider.discoveryState()).toEqual(state);
        });
    });

    describe('OAuthClientProvider contract shape', () => {
        it('implements every required member of the SDK interface', () => {
            // Getters return values directly.
            expect(provider.redirectUrl).toBeUndefined();
            expect(typeof provider.clientMetadata).toBe('object');
            expect(provider.clientMetadata.client_name).toBe('vault-intelligence');

            // Methods are functions on the prototype.
            const methods: readonly (keyof ObsidianOAuthClientProvider)[] = [
                'clientInformation',
                'tokens',
                'saveTokens',
                'redirectToAuthorization',
                'saveCodeVerifier',
                'codeVerifier',
            ];
            for (const key of methods) {
                expect(typeof (provider as unknown as Record<string, unknown>)[key as string])
                    .toBe('function');
            }
        });
    });
});