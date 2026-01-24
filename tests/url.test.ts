import { describe, it, expect } from 'vitest';
import { isPublicUrl } from '../src/utils/url';

describe('URL Utility', () => {
    describe('isPublicUrl', () => {
        it('should return true for HuggingFace domains', () => {
            expect(isPublicUrl('https://huggingface.co/models/foo')).toBe(true);
            expect(isPublicUrl('https://cdn-lfs.huggingface.co/models/foo')).toBe(true);
        });

        it('should return true for jsDelivr domains', () => {
            expect(isPublicUrl('https://jsdelivr.net/npm/package')).toBe(true);
            expect(isPublicUrl('https://cdn.jsdelivr.net/npm/package')).toBe(true);
        });

        it('should return false for malicious URLs containing keywords', () => {
            expect(isPublicUrl('https://evil.com/huggingface.co')).toBe(false);
            expect(isPublicUrl('https://evil.com?q=jsdelivr.net')).toBe(false);
            expect(isPublicUrl('https://huggingface.co.evil.com/file')).toBe(false);
            expect(isPublicUrl('https://jsdelivr.net.evil.com/file')).toBe(false);
        });

        it('should return false for invalid URLs', () => {
            expect(isPublicUrl('not-a-url')).toBe(false);
            expect(isPublicUrl('')).toBe(false);
        });
    });
});
