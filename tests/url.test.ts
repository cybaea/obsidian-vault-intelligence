import { describe, it, expect } from 'vitest';

import { isSafeUrl } from '../src/utils/url';

describe('URL Utility', () => {
    describe('isSafeUrl', () => {
        it('should return true for HuggingFace domains', () => {
            expect(isSafeUrl('https://huggingface.co/models/foo')).toBe(true);
            expect(isSafeUrl('https://cdn-lfs.huggingface.co/models/foo')).toBe(true);
        });

        it('should return true for jsDelivr domains', () => {
            expect(isSafeUrl('https://jsdelivr.net/npm/package')).toBe(true);
            expect(isSafeUrl('https://cdn.jsdelivr.net/npm/package')).toBe(true);
        });

        it('should return false for malicious URLs containing keywords', () => {
            expect(isSafeUrl('https://evil.com/huggingface.co')).toBe(false);
            expect(isSafeUrl('https://evil.com?q=jsdelivr.net')).toBe(false);
            expect(isSafeUrl('https://huggingface.co.evil.com/file')).toBe(false);
            expect(isSafeUrl('https://jsdelivr.net.evil.com/file')).toBe(false);
        });

        it('should return false for invalid URLs', () => {
            expect(isSafeUrl('not-a-url')).toBe(false);
            expect(isSafeUrl('')).toBe(false);
        });
    });
});
