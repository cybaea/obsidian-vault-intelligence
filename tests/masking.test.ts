import { describe, it, expect } from 'vitest';

import { maskSecret, maskObject } from '../src/utils/masking';

describe('Masking Utility', () => {
    describe('maskSecret', () => {
        it('should mask a long API key using sha256 fingerprint', async () => {
            const result = await maskSecret('DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY');
            expect(result).toMatch(/^sha256:[a-f0-9]{16}$/);
        });

        it('should return consistent fingerprints for the same secret', async () => {
            const secret = 'DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY';
            const res1 = await maskSecret(secret);
            const res2 = await maskSecret(secret);
            expect(res1).toBe(res2);
        });

        it('should return different fingerprints for different secrets', async () => {
            const res1 = await maskSecret('KEY_1');
            const res2 = await maskSecret('KEY_2');
            expect(res1).not.toBe(res2);
        });

        it('should return "None" for empty/null secrets', async () => {
            expect(await maskSecret(null)).toBe('None');
            expect(await maskSecret(undefined)).toBe('None');
            expect(await maskSecret('')).toBe('None');
        });
    });

    describe('maskObject', () => {
        it('should mask specified sensitive keys in an object', async () => {
            const input = {
                embeddingModel: 'gemini-embedding-001',
                googleApiKey: 'DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY',
                other: 'value'
            };
            const result = await maskObject(input);
            expect(result.googleApiKey).toMatch(/^sha256:[a-f0-9]{16}$/);
            expect(result.embeddingModel).toBe('gemini-embedding-001');
            expect(result.other).toBe('value');
        });

        it('should mask nested sensitive keys', async () => {
            const input: Record<string, unknown> = {
                config: {
                    googleApiKey: 'DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY'
                },
                level: 1
            };
            const result = await maskObject(input);
            const maskedConfig = result.config as Record<string, unknown>;
            expect(maskedConfig.googleApiKey).toMatch(/^sha256:[a-f0-9]{16}$/);
            expect(result.level).toBe(1);
        });
    });
});
