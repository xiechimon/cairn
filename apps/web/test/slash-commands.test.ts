// #731 `/` slash completion — tests first (ticket failure-mode list +
// D1 builtins). Pins, per section:
//   SLASH_COMPLETION_SPEC trigger (rules 39-41):
//     S1 row-head / whitespace / CJK punct trigger; mid-word refuses
//     S2 path form closes at the second slash (`/tmp/notes.md` -> null)
//     S3 space ends the token (rule 68); `@` adjacency never dual-opens
//        with the `@` detector (slash token class excludes `@`; `@` left
//        of `/` is outside the slash boundary class)
//     S4 skill-name charset round trip (`code-review`, `a:b`, `a.b`)
//   slashFilter (rules 48-49, two matcher families must never mix):
//     F1 word-boundary prefix incl. separator stripping + alias
//     F2 case-insensitive always (no smart case on this face)
//     F3 subsequence is NOT a match (`/sl` must not hit `spell-check`)
//     F4 empty query = caller order, capped at 15
//   registry + sections (D1: no placeholders):
//     R2 skill rows are insert kind; builtins execute kind
//     R3 availability gating: review/stop vanish when unavailable
//     R4 name collision: builtin wins, same-named skill hidden
//   accept resolution (approved semantics):
//     A1 message-start + Enter + execute = run
//     A2 message-start + Enter + skill = insert-token (prompt-type)
//     A3 mid-prompt accept = insert-text, never run
//     A4 Tab accept = insert (text for builtins, token for skills), never run
//     A5 isMessageStart: leading whitespace ok, prose before = false
//   insertSlashText:
//     T1 replaces the `/query` span with `/name `, caret after the space
import { describe, expect, test } from 'vitest';
import {
  type CompletionRange,
  detectCompletionToken,
} from '../src/overlay/completion.js';
import {
  type AvailableSlash,
  BUILTIN_SLASH_COMMANDS,
  buildSlashSections,
  insertSlashText,
  isMessageStart,
  resolveSlashAccept,
  type SkillEntry,
  slashFilter,
  SLASH_COMPLETION_SPEC,
} from '../src/overlay/slash-commands.js';

const detect = (value: string, caret: number): CompletionRange | null =>
  detectCompletionToken(value, caret, SLASH_COMPLETION_SPEC);

const skills = (...names: string[]): SkillEntry[] =>
  names.map((name, i) => ({ id: `s${i}`, name, description: `${name} does things` }));

const allAvailable: AvailableSlash = { review: true, stop: true };

describe('SLASH_COMPLETION_SPEC trigger (S1-S4)', () => {
  test('row head triggers with empty + non-empty query (S1)', () => {
    expect(detect('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(detect('/cl', 3)).toEqual({ start: 0, end: 3, query: 'cl' });
  });

  test('whitespace + CJK punctuation trigger (S1)', () => {
    expect(detect('hi /cl', 6)).toEqual({ start: 3, end: 6, query: 'cl' });
    expect(detect('line1\n/cl', 9)).toEqual({ start: 6, end: 9, query: 'cl' });
    expect(detect('好的。/cl', 6)).toEqual({ start: 3, end: 6, query: 'cl' });
  });

  test('mid-word slash refuses (S1)', () => {
    expect(detect('foo/cl', 6)).toBeNull();
    expect(detect('a/b', 3)).toBeNull();
  });

  test('path form closes at the second slash, text stays literal (S2)', () => {
    expect(detect('/tmp/notes.md', 13)).toBeNull();
    // while typing the first segment the token is still live
    expect(detect('/tm', 3)).toEqual({ start: 0, end: 3, query: 'tm' });
    expect(detect('/tmp', 4)).toEqual({ start: 0, end: 4, query: 'tmp' });
  });

  test('space ends the token (S3/rule 68)', () => {
    expect(detect('/cl ', 4)).toBeNull();
    expect(detect('hi /clear now', 12)).toBeNull();
  });

  test('no dual-open with the @ detector (S3)', () => {
    // `@` is outside the slash token class: `/@` closes the slash token
    expect(detect('/@foo', 5)).toBeNull();
    // `@` left of `/` is outside the slash boundary class
    expect(detect('@/foo', 5)).toBeNull();
  });

  test('skill-name charset round trip (S4)', () => {
    expect(detect('/code-review', 12)).toEqual({ start: 0, end: 12, query: 'code-review' });
    expect(detect('/a:b', 4)).toEqual({ start: 0, end: 4, query: 'a:b' });
    expect(detect('/a.b', 4)).toEqual({ start: 0, end: 4, query: 'a.b' });
    expect(detect('/deploy_app', 11)).toEqual({ start: 0, end: 11, query: 'deploy_app' });
  });
});

describe('slashFilter word-prefix matcher (F1-F4)', () => {
  const names = ['clear', 'attach', 'review', 'stop', 'help'];

  test('prefix + separator-stripped word prefix + alias (F1)', () => {
    expect(slashFilter('cl', names, String)).toEqual(['clear']);
    expect(slashFilter('adddir', ['add-dir', 'clear'], String)).toEqual(['add-dir']);
    expect(slashFilter('dir', ['add-dir', 'clear'], String)).toEqual(['add-dir']);
  });

  test('always case-insensitive, no smart case on this face (F2)', () => {
    expect(slashFilter('CL', names, String)).toEqual(['clear']);
    expect(slashFilter('Clear', names, String)).toEqual(['clear']);
  });

  test('subsequence is NOT a match — matcher families never mix (F3)', () => {
    expect(slashFilter('sl', ['spell-check', 'clear'], String)).toEqual([]);
    expect(slashFilter('dd', ['add-dir'], String)).toEqual([]);
    expect(slashFilter('ew', ['review'], String)).toEqual([]);
  });

  test('empty query = caller order, capped at 15 (F4)', () => {
    const many = Array.from({ length: 20 }, (_, i) => `cmd-${i}`);
    expect(slashFilter('', many, String)).toHaveLength(15);
    expect(slashFilter('', many, String)[0]).toBe('cmd-0');
    expect(slashFilter('', names, String)).toEqual(names);
  });
});

describe('registry + sections (R1-R4)', () => {
  test('five builtins, all execute, each with descKey (R1)', () => {
    expect(BUILTIN_SLASH_COMMANDS.map((c) => c.name)).toEqual([
      'clear',
      'attach',
      'review',
      'stop',
      'help',
    ]);
    for (const c of BUILTIN_SLASH_COMMANDS) {
      expect(c.kind).toBe('execute');
      expect(c.descKey.length).toBeGreaterThan(0);
    }
  });

  test('alias: `/new` highlights `/clear` via the registry (canon rule 48)', () => {
    const sections = buildSlashSections({ query: 'new', available: allAvailable, skills: [] });
    expect(sections.flatMap((s) => s.rows).map((r) => r.name)).toEqual(['clear']);
  });

  test('empty query: builtins first, then skills; skill rows are insert kind (R2)', () => {
    const sections = buildSlashSections({ query: '', available: allAvailable, skills: skills('b-skill', 'a-skill') });
    expect(sections).toHaveLength(2);
    expect(sections[0]?.rows.map((r) => r.name)).toEqual([
      'clear',
      'attach',
      'review',
      'stop',
      'help',
    ]);
    expect(sections[0]?.rows.every((r) => r.kind === 'execute')).toBe(true);
    expect(sections[1]?.rows.map((r) => r.name)).toEqual(['b-skill', 'a-skill']);
    expect(sections[1]?.rows.every((r) => r.kind === 'insert')).toBe(true);
  });

  test('unavailable review/stop vanish instead of going dead (R3)', () => {
    const sections = buildSlashSections({
      query: '',
      available: { review: false, stop: false },
      skills: [],
    });
    expect(sections[0]?.rows.map((r) => r.name)).toEqual(['clear', 'attach', 'help']);
  });

  test('builtin wins a name collision; same-named skill hidden (R4)', () => {
    const sections = buildSlashSections({
      query: 'cle',
      available: allAvailable,
      skills: skills('clear', 'cleanup'),
    });
    const all = sections.flatMap((s) => s.rows);
    expect(all.filter((r) => r.name === 'clear')).toHaveLength(1);
    expect(all.find((r) => r.name === 'clear')?.kind).toBe('execute');
    expect(all.map((r) => r.name)).toContain('cleanup');
  });

  test('query filters both sections; total capped at 15', () => {
    const many = Array.from({ length: 20 }, (_, i) => `z-cmd-${i}`);
    const sections = buildSlashSections({ query: '', available: allAvailable, skills: skills(...many) });
    expect(sections.flatMap((s) => s.rows)).toHaveLength(15);
    const filtered = buildSlashSections({ query: 'zzz-nope', available: allAvailable, skills: skills('a') });
    expect(filtered.flatMap((s) => s.rows)).toHaveLength(0);
  });
});

describe('accept resolution (A1-A5)', () => {
  test('message-start + Enter + execute = run (A1)', () => {
    expect(
      resolveSlashAccept({ name: 'clear', kind: 'execute', atStart: true, via: 'enter' }),
    ).toBe('run');
  });

  test('message-start + Enter + skill = insert-token (A2)', () => {
    expect(
      resolveSlashAccept({ name: 'b-skill', kind: 'insert', atStart: true, via: 'enter' }),
    ).toBe('insert-token');
  });

  test('mid-prompt: execute degrades to text, skill still inserts its token (A3)', () => {
    expect(
      resolveSlashAccept({ name: 'clear', kind: 'execute', atStart: false, via: 'enter' }),
    ).toBe('insert-text');
    // AC49 carries no message-start qualifier: a mid-prompt literal
    // `/name` would be a dead reference, so skills always land the token.
    expect(
      resolveSlashAccept({ name: 'b-skill', kind: 'insert', atStart: false, via: 'enter' }),
    ).toBe('insert-token');
  });

  test('Tab accept never runs (A4)', () => {
    expect(
      resolveSlashAccept({ name: 'clear', kind: 'execute', atStart: true, via: 'tab' }),
    ).toBe('insert-text');
    expect(
      resolveSlashAccept({ name: 'b-skill', kind: 'insert', atStart: true, via: 'tab' }),
    ).toBe('insert-token');
  });

  test('isMessageStart: leading whitespace ok, prose before = false (A5)', () => {
    expect(isMessageStart('/clear', 0)).toBe(true);
    expect(isMessageStart('  /clear', 2)).toBe(true);
    expect(isMessageStart('hi /clear', 3)).toBe(false);
  });
});

describe('insertSlashText (T1)', () => {
  test('replaces the /query span with /name + trailing space', () => {
    expect(insertSlashText('/cl', { start: 0, end: 3, query: 'cl' }, 'clear')).toEqual({
      value: '/clear ',
      caret: 7,
    });
    expect(insertSlashText('hi /cl', { start: 3, end: 6, query: 'cl' }, 'clear')).toEqual({
      value: 'hi /clear ',
      caret: 10,
    });
  });
});
