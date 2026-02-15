import { describe, it, expect } from 'vitest';

import { isSafeUrl, isExternalUrl } from '../src/utils/url';

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

    describe('isExternalUrl', () => {
        it('should allow public https/http URLs', () => {
            expect(isExternalUrl('https://google.com')).toBe(true);
            expect(isExternalUrl('http://example.org/path')).toBe(true);
            expect(isExternalUrl('https://github.com/cybaea/obsidian-vault-intelligence')).toBe(true);
        });

        it('should block local/loopback hostnames', () => {
            expect(isExternalUrl('http://localhost')).toBe(false);
            expect(isExternalUrl('http://localhost:8080')).toBe(false);
            expect(isExternalUrl('https://127.0.0.1')).toBe(false);
            expect(isExternalUrl('http://[::1]')).toBe(false);
            expect(isExternalUrl('http://0.0.0.0')).toBe(false);
            expect(isExternalUrl('http://[::]')).toBe(false);
        });

        it('should block 127.x.x.x range', () => {
            expect(isExternalUrl('http://127.0.0.5')).toBe(false);
            expect(isExternalUrl('http://127.255.255.255')).toBe(false);
        });

        it('should block private IP ranges (IPv4)', () => {
            expect(isExternalUrl('http://10.0.0.1')).toBe(false);
            expect(isExternalUrl('http://192.168.1.100')).toBe(false);
            expect(isExternalUrl('http://172.16.0.1')).toBe(false);
            expect(isExternalUrl('http://172.31.255.255')).toBe(false);
        });

        it('should allow public IPs near private ranges', () => {
            expect(isExternalUrl('http://172.15.255.255')).toBe(true);
            expect(isExternalUrl('http://172.32.0.0')).toBe(true);
        });

        it('should block cloud metadata IPs', () => {
            expect(isExternalUrl('http://169.254.169.254')).toBe(false);
            expect(isExternalUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
        });

        it('should block restricted protocols', () => {
            expect(isExternalUrl('file:///etc/passwd')).toBe(false);
            expect(isExternalUrl('app://obsidian.md/index.html')).toBe(false);
            expect(isExternalUrl('ftp://example.com')).toBe(false);
        });

        it('should handle obfuscated IP formats if URL constructor normalizes them', () => {
            // http://2130706433/ is http://127.0.0.1/
            // URL constructor usually normalizes this.
            expect(isExternalUrl('http://2130706433/')).toBe(false);
            expect(isExternalUrl('http://0x7f000001/')).toBe(false);
        });

        it('should return false for invalid URLs', () => {
            expect(isExternalUrl('random-string')).toBe(false);
            expect(isExternalUrl('')).toBe(false);
        });
    });
});
