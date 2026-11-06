import { describe, expect, it } from 'vitest';

import { REGEX_CONSTANTS } from '../src/constants';

/**
 * Behavior contract for REGEX_CONSTANTS.MENTION after removing the regex
 * lookbehind from its boundary (lookbehind is unsupported on iOS versions
 * before 16.4 and threw a SyntaxError at plugin load on those devices).
 *
 * The boundary is now matched with a consumed non-capturing prefix, so the
 * observable behavior for consumers — the capture groups fed to
 * `AgentService.prepareContext` — must stay identical to the lookbehind era:
 * mentions are found at the string start, after whitespace, and after
 * punctuation, but never inside a word token such as an email address.
 */
const mentionNames = (input: string): (string | undefined)[] =>
    Array.from(input.matchAll(REGEX_CONSTANTS.MENTION)).map(m => m[1] || m[2] || m[3]);

describe('REGEX_CONSTANTS.MENTION (lookbehind-free boundary)', () => {
    it('matches a wikilink mention at the start of the string', () => {
        expect(mentionNames('@[[Folder/Note]]')).toEqual(['Folder/Note']);
    });

    it('matches a wikilink mention containing an alias segment', () => {
        expect(mentionNames('see @[[Note|Alias]] please')).toEqual(['Note|Alias']);
    });

    it('matches a quoted mention after a space', () => {
        expect(mentionNames('see @"My Note" here')).toEqual(['My Note']);
    });

    it('matches a bare mention with dots and dashes after a space', () => {
        expect(mentionNames('check @README-v2.md now')).toEqual(['README-v2.md']);
    });

    it('matches a mention after non-word punctuation', () => {
        expect(mentionNames('path/@folder')).toEqual(['folder']);
    });

    it('matches several mentions in one message', () => {
        expect(mentionNames('@a and @b')).toEqual(['a', 'b']);
    });

    it('matches case-insensitively', () => {
        expect(mentionNames('read @FILE-NOTE_A1.txt now')).toEqual(['FILE-NOTE_A1.txt']);
    });

    it('does not match an @ inside a word token (email-like text)', () => {
        expect(mentionNames('contact bob@host.example for help')).toEqual([]);
    });

    it('does not match an @ directly after a word character', () => {
        expect(mentionNames('hi@there')).toEqual([]);
    });

    it('yields one mention for adjacent double @ characters', () => {
        expect(mentionNames('@@weird')).toEqual(['weird']);
    });

    it('does not match a bare @ with no mention body', () => {
        expect(mentionNames('hello @ there')).toEqual([]);
    });
});
