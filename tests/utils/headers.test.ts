import { describe, it, expect, vi } from 'vitest';

import { validateHeaderKey, sanitizeHeaders, mergeHeaders } from '../../src/utils/headers';

describe('Header Utilities', () => {
    describe('validateHeaderKey', () => {
        it('should accept valid header keys', () => {
            expect(validateHeaderKey('X-Custom-Header').valid).toBe(true);
            expect(validateHeaderKey('Authorization').valid).toBe(true);
            expect(validateHeaderKey('api_key').valid).toBe(true);
            expect(validateHeaderKey('Content-Type').valid).toBe(true);
        });

        it('should reject empty or non-string keys', () => {
                        expect(validateHeaderKey('').valid).toBe(false);
                        expect(validateHeaderKey(null as unknown as string).valid).toBe(false);
        });

        it('should reject keys with invalid characters', () => {
            expect(validateHeaderKey('X-Custom Header').valid).toBe(false);
            expect(validateHeaderKey('X-Custom@Header').valid).toBe(false);
            expect(validateHeaderKey('X-Custom:Header').valid).toBe(false);
        });

        it('should reject restricted headers', () => {
            expect(validateHeaderKey('Host').valid).toBe(false);
            expect(validateHeaderKey('Content-Length').valid).toBe(false);
            expect(validateHeaderKey('Transfer-Encoding').valid).toBe(false);
            expect(validateHeaderKey('Connection').valid).toBe(false);
            expect(validateHeaderKey('Upgrade').valid).toBe(false);
        });

        it('should be case-insensitive for restricted headers', () => {
            expect(validateHeaderKey('host').valid).toBe(false);
            expect(validateHeaderKey('HOST').valid).toBe(false);
        });
    });

    describe('sanitizeHeaders', () => {
        it('should remove restricted headers and log warnings', () => {
            const logger = { warn: vi.fn() };
            const headers = {
                'Content-Length': '123',
                'Host': 'malicious.com',
                'X-Allowed': 'value1'
            };

            const sanitized = sanitizeHeaders(headers, logger);

            expect(sanitized).toEqual({ 'X-Allowed': 'value1' });
            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('restricted'));
        });

        it('should remove headers with invalid keys', () => {
            const logger = { warn: vi.fn() };
            const headers = {
                'Invalid Key': 'value',
                'Valid-Key': 'value'
            };

            const sanitized = sanitizeHeaders(headers, logger);

            expect(sanitized).toEqual({ 'Valid-Key': 'value' });
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid characters'));
        });
    });

    describe('mergeHeaders', () => {
        it('should merge multiple header objects', () => {
            const h1 = { 'X-H1': 'v1', 'X-Shared': 'v1' };
            const h2 = { 'X-H2': 'v2', 'X-Shared': 'v2' };
            
            const merged = mergeHeaders(h1, h2);
            
            expect(merged).toEqual({
                'X-H1': 'v1',
                'X-H2': 'v2',
                'X-Shared': 'v2'
            });
        });

        it('should handle undefined or null inputs', () => {
            const h1 = { 'X-H1': 'v1' };
            expect(mergeHeaders(h1, undefined, null as unknown as Record<string, string>)).toEqual(h1);
        });

        it('should be case-insensitive when merging', () => {
            const h1 = { 'X-Custom': 'v1' };
            const h2 = { 'x-custom': 'v2' };
            
            const merged = mergeHeaders(h1, h2);
            
            // Last one wins, and it should preserve the case of the last one
            expect(merged).toEqual({ 'x-custom': 'v2' });
            expect(Object.keys(merged)).toHaveLength(1);
        });

        it('should replace existing key with different case', () => {
             const h1 = { 'Authorization': 'Bearer 1' };
             const h2 = { 'authorization': 'Bearer 2' };
             const merged = mergeHeaders(h1, h2);
             expect(merged).toEqual({ 'authorization': 'Bearer 2' });
        });
    });
});
