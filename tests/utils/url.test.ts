import { expect, test, describe } from 'vitest';

import { isExternalUrl } from '../../src/utils/url';

describe('url utils', () => {
    describe('isExternalUrl', () => {
        test('blocks standard loopback', () => {
            expect(isExternalUrl('http://127.0.0.1')).toBe(false);
            expect(isExternalUrl('http://localhost')).toBe(false);
        });

        test('blocks SSRF bypass with trailing dots', () => {
            expect(isExternalUrl('http://169.254.169.254.')).toBe(false);
            expect(isExternalUrl('http://localhost.')).toBe(false);
        });

        test('blocks IPv4-mapped IPv6 loopbacks', () => {
            expect(isExternalUrl('http://[::ffff:127.0.0.1]')).toBe(false);
            expect(isExternalUrl('http://[0:0:0:0:0:ffff:127.0.0.1]')).toBe(false);
            expect(isExternalUrl('http://[::ffff:169.254.169.254]')).toBe(false);
        });

        test('allows valid external URLs', () => {
            expect(isExternalUrl('http://example.com')).toBe(true);
            expect(isExternalUrl('https://google.com')).toBe(true);
        });

        test('blocks non-http protocols', () => {
            expect(isExternalUrl('file:///etc/passwd')).toBe(false);
            expect(isExternalUrl('ftp://example.com')).toBe(false);
        });
    });
});
