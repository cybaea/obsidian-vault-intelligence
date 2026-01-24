import { describe, it, expect } from 'vitest';
import { maskSecret, maskObject } from '../src/utils/masking';

describe('Masking Utility', () => {
    describe('maskSecret', () => {
        it('should mask a long API key', () => {
            expect(maskSecret('AIzaSyDqZ5Kg2o3xcZ4Q9heo2caeK3gY7Q9Zuwk')).toBe('AIza...Zuwk');
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
                googleApiKey: 'AIzaSyDqZ5Kg2o3xcZ4Q9heo2caeK3gY7Q9Zuwk',
                embeddingModel: 'gemini-embedding-001',
                other: 'value'
            };
            const expected = {
                googleApiKey: 'AIza...Zuwk',
                embeddingModel: 'gemini-embedding-001',
                other: 'value'
            };
            expect(maskObject(input)).toEqual(expected);
        });

        it('should mask nested sensitive keys', () => {
            const input: Record<string, unknown> = {
                config: {
                    googleApiKey: 'AIzaSyDqZ5Kg2o3xcZ4Q9heo2caeK3gY7Q9Zuwk'
                },
                level: 1
            };
            const expected = {
                config: {
                    googleApiKey: 'AIza...Zuwk'
                },
                level: 1
            };
            expect(maskObject(input)).toEqual(expected);
        });
    });
});
