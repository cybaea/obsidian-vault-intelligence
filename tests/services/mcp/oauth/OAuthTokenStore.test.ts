import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    DefaultOAuthTokenStore,
    oauthSecretKey,
} from '../../../../src/services/mcp/oauth/OAuthTokenStore';

// Stub the logger so error paths do not spam the test console and so we can
// assert on warn/error calls when SecretStorage is missing methods.
vi.mock('../../../../src/utils/logger', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

interface FakeSecretStorage {
    clearSecret: Mock<(key: string) => void>;
    getSecret: Mock<(key: string) => string | null>;
    setSecret: Mock<(key: string, value: string) => void>;
}

function makeFakeStorage(initial: Record<string, string> = {}): {
    storage: FakeSecretStorage;
    store: Map<string, string>;
} {
    const map = new Map<string, string>(Object.entries(initial));
    const storage: FakeSecretStorage = {
        clearSecret: vi.fn((key: string) => { map.delete(key); }),
        getSecret: vi.fn((key: string) => map.get(key) ?? null),
        setSecret: vi.fn((key: string, value: string) => { map.set(key, value); }),
    };
    return { storage, store: map };
}

const SERVER_ID = 'srv-1';

describe('oauthSecretKey', () => {
    it('builds the mcp-<id>-oauth-<suffix> key', () => {
        expect(oauthSecretKey(SERVER_ID, 'tokens')).toBe('mcp-srv-1-oauth-tokens');
        expect(oauthSecretKey(SERVER_ID, 'client-secret')).toBe('mcp-srv-1-oauth-client-secret');
    });
});

describe('DefaultOAuthTokenStore', () => {
    let storage: FakeSecretStorage;
    let store: Map<string, string>;
    let tokenStore: DefaultOAuthTokenStore;

    beforeEach(() => {
        vi.clearAllMocks();
        const fake = makeFakeStorage();
        storage = fake.storage;
        store = fake.store;
        tokenStore = new DefaultOAuthTokenStore(storage);
    });

    describe('tokens round-trip', () => {
        it('persists and reloads tokens, computing expires_at', async () => {
            const now = 1_700_000_000_000;
            const realNow = Date.now;
            Date.now = () => now;

            try {
                await tokenStore.saveTokens(SERVER_ID, {
                    access_token: 'access-abc',
                    expires_in: 3600,
                    refresh_token: 'refresh-xyz',
                    scope: 'read write',
                    token_type: 'Bearer',
                });
            } finally {
                Date.now = realNow;
            }

            const persistedRaw = store.get(oauthSecretKey(SERVER_ID, 'tokens'));
            expect(persistedRaw).toBeDefined();
            const persisted = JSON.parse(persistedRaw as string);
            expect(persisted.access_token).toBe('access-abc');
            expect(persisted.expires_at).toBe(now + 3600 * 1000);
            expect(persisted.refresh_token).toBe('refresh-xyz');

            const loaded = await tokenStore.loadTokens(SERVER_ID);
            expect(loaded).toBeDefined();
            expect(loaded?.access_token).toBe('access-abc');
            expect(loaded?.expires_at).toBe(now + 3600 * 1000);
            expect(loaded?.expires_in).toBe(3600);
            expect(loaded?.refresh_token).toBe('refresh-xyz');
            expect(loaded?.scope).toBe('read write');
            expect(loaded?.token_type).toBe('Bearer');
        });

        it('persists expires_at as Infinity when expires_in is absent', async () => {
            await tokenStore.saveTokens(SERVER_ID, {
                access_token: 'access-no-exp',
                token_type: 'Bearer',
            });

            const loaded = await tokenStore.loadTokens(SERVER_ID);
            expect(loaded).toBeDefined();
            expect(loaded?.expires_at).toBe(Number.POSITIVE_INFINITY);
            expect(loaded?.expires_in).toBeUndefined();
        });

        it('returns undefined when no tokens are stored', async () => {
            expect(await tokenStore.loadTokens(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when the stored JSON is corrupted', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'tokens'), 'not-json');
            expect(await tokenStore.loadTokens(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when access_token is missing from the stored entry', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'tokens'), JSON.stringify({ expires_at: 123 }));
            expect(await tokenStore.loadTokens(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when expires_at is not a number', async () => {
            store.set(
                oauthSecretKey(SERVER_ID, 'tokens'),
                JSON.stringify({ access_token: 'abc', expires_at: 'oops' }),
            );
            expect(await tokenStore.loadTokens(SERVER_ID)).toBeUndefined();
        });
    });

    describe('verifier persistence', () => {
        it('round-trips the PKCE code verifier', async () => {
            await tokenStore.saveVerifier(SERVER_ID, 'verifier-123');
            expect(await tokenStore.loadVerifier(SERVER_ID)).toBe('verifier-123');
        });

        it('returns undefined when no verifier is stored', async () => {
            expect(await tokenStore.loadVerifier(SERVER_ID)).toBeUndefined();
        });
    });

    describe('client information and secret separation', () => {
        it('persists client info without the secret in the JSON', async () => {
            await tokenStore.saveClientInformation(SERVER_ID, {
                client_id: 'cid-1',
                client_id_issued_at: 1000,
                client_secret: 'super-secret',
            });

            const storedInfo = store.get(oauthSecretKey(SERVER_ID, 'client'));
            expect(storedInfo).toBeDefined();
            const parsed = JSON.parse(storedInfo as string);
            expect(parsed.client_id).toBe('cid-1');
            // The store strips the secret from the client-info JSON. The
            // provider is responsible for persisting the secret under its
            // own key via `saveClientSecret`.
            expect(parsed.client_secret).toBeUndefined();
            expect(store.has(oauthSecretKey(SERVER_ID, 'client-secret'))).toBe(false);
        });

        it('loads client info and merges the secret back in', async () => {
            store.set(
                oauthSecretKey(SERVER_ID, 'client'),
                JSON.stringify({ client_id: 'cid-2', client_id_issued_at: 2000 }),
            );
            store.set(oauthSecretKey(SERVER_ID, 'client-secret'), 'merged-secret');

            const loaded = await tokenStore.loadClientInformation(SERVER_ID);
            expect(loaded).toBeDefined();
            expect(loaded?.client_id).toBe('cid-2');
        });

        it('loadClientSecret returns the stored secret', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'client-secret'), 'the-secret');
            expect(await tokenStore.loadClientSecret(SERVER_ID)).toBe('the-secret');
        });

        it('returns undefined when no client info is stored', async () => {
            expect(await tokenStore.loadClientInformation(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when client_id is missing from stored entry', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'client'), JSON.stringify({}));
            expect(await tokenStore.loadClientInformation(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when the stored client JSON is corrupted', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'client'), 'not-json');
            expect(await tokenStore.loadClientInformation(SERVER_ID)).toBeUndefined();
        });
    });

    describe('discovery state', () => {
        it('round-trips discovery state', async () => {
            const state = {
                authorizationServerUrl: 'https://auth.example.com',
            };
            await tokenStore.saveDiscoveryState(SERVER_ID, state);

            const loaded = await tokenStore.loadDiscoveryState(SERVER_ID);
            expect(loaded).toBeDefined();
            expect(loaded?.authorizationServerUrl).toBe('https://auth.example.com');
        });

        it('returns undefined when no discovery state is stored', async () => {
            expect(await tokenStore.loadDiscoveryState(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when authorizationServerUrl is missing', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'discovery'), JSON.stringify({}));
            expect(await tokenStore.loadDiscoveryState(SERVER_ID)).toBeUndefined();
        });

        it('returns undefined when the stored discovery JSON is corrupted', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'discovery'), 'not-json');
            expect(await tokenStore.loadDiscoveryState(SERVER_ID)).toBeUndefined();
        });
    });

    describe('invalidation by scope', () => {
        const populate = (): void => {
            store.set(oauthSecretKey(SERVER_ID, 'tokens'), '{"access_token":"a","expires_at":1}');
            store.set(oauthSecretKey(SERVER_ID, 'verifier'), 'v');
            store.set(oauthSecretKey(SERVER_ID, 'client'), '{"client_id":"c"}');
            store.set(oauthSecretKey(SERVER_ID, 'client-secret'), 's');
            store.set(oauthSecretKey(SERVER_ID, 'discovery'), '{"authorizationServerUrl":"u"}');
        };

        it("'tokens' clears only the tokens key", async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'tokens');
            expect(store.has(oauthSecretKey(SERVER_ID, 'tokens'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'verifier'))).toBe(true);
            expect(store.has(oauthSecretKey(SERVER_ID, 'client'))).toBe(true);
            expect(store.has(oauthSecretKey(SERVER_ID, 'client-secret'))).toBe(true);
            expect(store.has(oauthSecretKey(SERVER_ID, 'discovery'))).toBe(true);
        });

        it("'verifier' clears only the verifier key", async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'verifier');
            expect(store.has(oauthSecretKey(SERVER_ID, 'verifier'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'tokens'))).toBe(true);
        });

        it("'client' clears both the client and client-secret keys", async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'client');
            expect(store.has(oauthSecretKey(SERVER_ID, 'client'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'client-secret'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'tokens'))).toBe(true);
            expect(store.has(oauthSecretKey(SERVER_ID, 'verifier'))).toBe(true);
            expect(store.has(oauthSecretKey(SERVER_ID, 'discovery'))).toBe(true);
        });

        it("'discovery' clears only the discovery key", async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'discovery');
            expect(store.has(oauthSecretKey(SERVER_ID, 'discovery'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'tokens'))).toBe(true);
        });

        it("'all' clears every OAuth key", async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'all');
            expect(store.has(oauthSecretKey(SERVER_ID, 'tokens'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'verifier'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'client'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'client-secret'))).toBe(false);
            expect(store.has(oauthSecretKey(SERVER_ID, 'discovery'))).toBe(false);
        });

        it('invokes clearSecret on the underlying storage', async () => {
            populate();
            await tokenStore.invalidate(SERVER_ID, 'tokens');
            expect(storage.clearSecret).toHaveBeenCalledWith(oauthSecretKey(SERVER_ID, 'tokens'));
        });
    });

    describe('SecretStorage feature degradation', () => {
        it('warns when setSecret is unavailable', async () => {
            const { logger } = await import('../../../../src/utils/logger');
            const readOnly = { getSecret: vi.fn((k: string) => store.get(k) ?? null) };
            const readonlyStore = new DefaultOAuthTokenStore(readOnly);
            await readonlyStore.saveVerifier(SERVER_ID, 'v');
            expect(logger.warn).toHaveBeenCalled();
            expect(store.has(oauthSecretKey(SERVER_ID, 'verifier'))).toBe(false);
        });

        it('overwrites with empty string when clearSecret is unavailable but setSecret is present', async () => {
            store.set(oauthSecretKey(SERVER_ID, 'verifier'), 'v');
            const noClear = {
                getSecret: vi.fn((k: string) => store.get(k) ?? null),
                setSecret: vi.fn((k: string, value: string) => { store.set(k, value); }),
            };
            const noClearStore = new DefaultOAuthTokenStore(noClear);
            await noClearStore.invalidate(SERVER_ID, 'verifier');
            expect(store.get(oauthSecretKey(SERVER_ID, 'verifier'))).toBe('');
        });

        it('getSecret errors are swallowed and return null', async () => {
            const failing = {
                clearSecret: vi.fn(),
                getSecret: vi.fn(() => { throw new Error('boom'); }),
                setSecret: vi.fn(),
            };
            const failingStore = new DefaultOAuthTokenStore(failing);
            expect(await failingStore.loadVerifier(SERVER_ID)).toBeUndefined();
        });
    });
});