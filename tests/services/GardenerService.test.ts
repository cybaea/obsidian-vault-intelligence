import { describe, expect, it, vi } from 'vitest';

import { isFileWellManaged } from '../../src/services/GardenerService';

describe('GardenerService.isFileWellManaged', () => {
    const topicKeys = ['topics', 'topic'];

    it('returns false if frontmatter is null/undefined', () => {
        expect(isFileWellManaged(undefined, topicKeys, () => true)).toBe(false);
    });

    it('returns false if no topic keys match', () => {
        const fm = { tags: ['a'], title: 'test' };
        expect(isFileWellManaged(fm, topicKeys, () => true)).toBe(false);
    });

    it('returns false if topic value is an empty array', () => {
        const fm = { topics: [] };
        expect(isFileWellManaged(fm, topicKeys, () => true)).toBe(false);
    });

    it('returns false if topic value is empty string', () => {
        const fm = { topic: "" };
        expect(isFileWellManaged(fm, topicKeys, () => true)).toBe(false);
    });

    it('gracefully handles single string value', () => {
        const fm = { topic: "Single Topic" };
        const validator = vi.fn().mockImplementation((t) => t === "Single Topic");
        expect(isFileWellManaged(fm, topicKeys, validator)).toBe(true);
        expect(validator).toHaveBeenCalledWith("Single Topic");
    });

    it('gracefully handles array of strings', () => {
        const fm = { topics: ["Topic A", "Topic B"] };
        const validator = vi.fn().mockReturnValue(true);
        expect(isFileWellManaged(fm, topicKeys, validator)).toBe(true);
        expect(validator).toHaveBeenCalledTimes(2);
    });

    it('returns false and breaks early if ANY topic is invalid', () => {
        const fm = { topics: ["Valid", "Invalid", "Valid2"] };
        const validator = vi.fn().mockImplementation((t) => t !== "Invalid");
        
        expect(isFileWellManaged(fm, topicKeys, validator)).toBe(false);
        // Should break on the second item ("Invalid"), so it's called 2 times, not 3.
        expect(validator).toHaveBeenCalledTimes(2);
    });

    it('checks the first matching key from topicKeys array', () => {
        // 'topics' is checked before 'topic' based on the topicKeys array order
        const fm = { topic: "Invalid", topics: ["Valid"] };
        const validator = vi.fn().mockImplementation((t) => t === "Valid");
        expect(isFileWellManaged(fm, topicKeys, validator)).toBe(true);
    });
});
