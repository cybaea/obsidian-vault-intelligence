import { describe, it, expect } from 'vitest';
import { maskSecret, maskObject } from '../src/utils/masking';

describe('Masking Utility', () => {
    describe('maskSecret', () => {
        it('should mask a long API key', () => {
            expect(maskSecret('DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY')).toBe('DUMM...ONLY');
        });

        it('should return "****" for short secrets', () => {
            expect(maskSecret('1234567')).toBe('****');
            expect(maskSecret('12345678')).toBe('****');
        });

        it('should return "None" for empty/null secrets', () => {
            expect(maskSecret(null)).toBe('None');
            expect(maskSecret(undefined)).toBe('None');
            expect(maskSecret('')).toBe('None');
        });
    });

    describe('maskObject', () => {
        it('should mask specified sensitive keys in an object', () => {
            const input = {
                googleApiKey: 'DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY',
                embeddingModel: 'gemini-embedding-001',
                other: 'value'
            };
            const expected = {
                googleApiKey: 'DUMM...ONLY',
                embeddingModel: 'gemini-embedding-001',
                other: 'value'
            };
            expect(maskObject(input)).toEqual(expected);
        });

        it('should mask nested sensitive keys', () => {
            const input: Record<string, unknown> = {
                config: {
                    googleApiKey: 'DUMMY_KEY_FOR_TESTING_PURPOSES_ONLY'
                },
                level: 1
            };
            const expected = {
                config: {
                    googleApiKey: 'DUMM...ONLY'
                },
                level: 1
            };
            expect(maskObject(input)).toEqual(expected);
        });
    });
});
