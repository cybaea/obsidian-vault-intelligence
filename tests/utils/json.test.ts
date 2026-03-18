import { expect, describe, it } from 'vitest';

import { truncateJsonStrings } from '../../src/utils/json';

describe('JSON Utilities', () => {
    describe('truncateJsonStrings', () => {
        it('should truncate strings exceeding the limit', () => {
            const result = truncateJsonStrings('This is a very long string', 10);
            expect(result).toBe('This is a ... [Truncated 16 characters]');
        });

        it('should not truncate strings within the limit', () => {
            const result = truncateJsonStrings('Short', 10);
            expect(result).toBe('Short');
        });

        it('should recursively truncate strings in arrays', () => {
            const result = truncateJsonStrings(['Short', 'This is a very long string'], 10);
            expect(result).toEqual(['Short', 'This is a ... [Truncated 16 characters]']);
        });

        it('should recursively truncate strings in objects', () => {
            const obj = {
                a: 'Short',
                b: 'This is a very long string',
                c: { nested: 'Another very long string here' }
            };
            const result = truncateJsonStrings(obj, 10);
            expect(result).toEqual({
                a: 'Short',
                b: 'This is a ... [Truncated 16 characters]',
                c: { nested: 'Another ve... [Truncated 19 characters]' }
            });
        });

        it('should preserve non-string values', () => {
            const obj = {
                bool: true,
                nil: null,
                num: 42
            };
            const result = truncateJsonStrings(obj, 10);
            expect(result).toEqual({
                bool: true,
                nil: null,
                num: 42
            });
        });
    });
});
