import { describe, expect, test } from 'vitest';
import {
  type FileMentionEntry,
  buildInlineRows,
  formatFileInsert,
  insertFileText,
  insertMentionText,
  type InlineRosterGroups,
  type MentionToken,
  parseDraftChips,
  parseMentionSegments,
  serializeMention,
} from '../src/overlay/mention-token.js';

const BUILDER: MentionToken = { kind: 'agent', label: 'builder', id: 'a1' };
const SERIALIZED = serializeMention(BUILDER); // [builder](agent:a1)

describe('insertMentionText trailing space + caret (I1/rule 26 + r9 §3.2)', () => {
  test('insert at end of text: token + one trailing space, caret lands after the space', () => {
    const r = insertMentionText('hello ', BUILDER, 6);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('insert mid-word: one space padded on each side (r9 §3.2 both-sides-spaced shape)', () => {

    const r = insertMentionText('helloworld', BUILDER, 5);
    expect(r.value).toBe(`hello ${SERIALIZED} world`);
    expect(r.caret).toBe(6 + SERIALIZED.length + 1);
  });

  test('trailing neighbor already whitespace: no double space, caret still lands after the token (trailing whitespace is the caret position)', () => {
    const r = insertMentionText('hello  world', BUILDER, 6);
    expect(r.value).toBe(`hello ${SERIALIZED} world`);
    expect(r.caret).toBe(6 + SERIALIZED.length);
  });

  test('leading neighbor already whitespace: no double leading space (existing behavior unregressed, I3)', () => {
    const r = insertMentionText('hi ', BUILDER, 3);
    expect(r.value).toBe(`hi ${SERIALIZED} `);
    expect(r.value.startsWith('hi  ')).toBe(false);
  });

  test('at = null append path: piece padded with spaces on both sides (I3 existing behavior)', () => {
    const r = insertMentionText('draft', BUILDER, null);
    expect(r.value).toBe(`draft ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('caret position stays typeable: the character right after insertion lands behind the trailing space, markdown unbroken (I1)', () => {
    const r = insertMentionText('', BUILDER, 0);
    const typed = `${r.value.slice(0, r.caret)}x${r.value.slice(r.caret)}`;
    expect(typed).toBe(`${SERIALIZED} x`);

    const segs = parseMentionSegments(r.value);
    expect(segs.filter((s) => s.kind === 'mention')).toHaveLength(1);
  });
});

describe('insertMentionText range replacement (I2+I4, inline @ path)', () => {
  test('@query replaced whole, no residue (I4 current-defect pin)', () => {

    const r = insertMentionText('hello @bu', BUILDER, 6, 9);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('text after @query: the replacement range eats only [start, end), neighbor text verbatim (I2)', () => {
    const r = insertMentionText('@bu rest', BUILDER, 0, 3);
    expect(r.value).toBe(`${SERIALIZED} rest`);
    expect(r.caret).toBe(SERIALIZED.length);
  });

  test('empty query (bare @) replacement: eats only the single @ character', () => {
    const r = insertMentionText('hi @', BUILDER, 3, 4);
    expect(r.value).toBe(`hi ${SERIALIZED} `);
  });

  test('replaceEnd default = pure insertion (popover / new-task paths unaffected, I3)', () => {
    const r = insertMentionText('hello @bu', BUILDER, 6);

    expect(r.value).toContain('@bu');
  });

  test('replaceEnd clamped to the value length (stale ranges cannot eat through text, I2)', () => {
    const r = insertMentionText('hello @bu', BUILDER, 6, 99);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
  });
});

describe('serializeMention (existing wire shape unregressed, I3)', () => {
  test('agent → markdown link + agent: scheme', () => {
    expect(SERIALIZED).toBe('[builder](agent:a1)');
  });

  test('todo → plain-text #seq', () => {
    expect(serializeMention({ kind: 'todo', label: '#3', id: 't1', seq: 3 })).toBe('#3');
  });

  test('label containing ] and \\ is escaped (escapeLabel existing face)', () => {
    expect(serializeMention({ kind: 'agent', label: 'a]b\\c', id: 'x' })).toBe(
      '[a\\]b\\\\c](agent:x)',
    );
  });
});

describe('insertFileText bare-path insertion (#760, CC rules 26-29 same shape)', () => {
  test('plain path: trailing space + caret lands after the space (J2/rule 26)', () => {
    const r = insertFileText('hello @but', 'apps/web/src/ui/button.tsx', 6, 10);
    expect(r.value).toBe('hello apps/web/src/ui/button.tsx ');
    expect(r.caret).toBe(r.value.length);
  });

  test('paths containing spaces wrapped in quotes (J1/rule 27)', () => {
    expect(formatFileInsert('apps/web/src/with space.ts')).toBe('"apps/web/src/with space.ts"');
    const r = insertFileText('@with', 'apps/web/src/with space.ts', 0, 5);
    expect(r.value).toBe('"apps/web/src/with space.ts" ');
  });

  test('paths without whitespace get no quotes', () => {
    expect(formatFileInsert('apps/web/src/ui/button.tsx')).toBe('apps/web/src/ui/button.tsx');
  });

  test('directory labels carry a trailing / (CC rule 28/29, the caller already appends it when composing the label)', () => {
    const r = insertFileText('@apps', 'apps/', 0, 5);
    expect(r.value).toBe('apps/ ');
  });

  test('@query replaced whole, no residue (J3, same law as I4)', () => {
    const r = insertFileText('hello @bu rest', 'apps/web/src/ui/button.tsx', 6, 9);
    expect(r.value).toBe('hello apps/web/src/ui/button.tsx rest');
  });

  test('the inserted path produces no mention chip (J4: a parenthesized path is not a scheme shape)', () => {
    const r = insertFileText('', 'apps/web/src/foo(bar).ts', 0);
    const segs = parseMentionSegments(r.value);
    expect(segs.filter((s) => s.kind === 'mention')).toHaveLength(0);
  });
});

const CHIP_FILES: FileMentionEntry[] = [
  { path: 'apps/web/src/ui/button.tsx', type: 'blob' },
  { path: 'apps/web/src/ui', type: 'tree' },
  { path: 'docs/my notes.md', type: 'blob' },
];

describe('parseDraftChips (#812, C1–C5)', () => {
  test('agent-scheme links become chips (same shape as transcript: label + id)', () => {
    const chips = parseDraftChips('hi [builder](agent:a1) ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'agent', id: 'a1', label: 'builder' });
  });

  test('todo-scheme links become chips, bare `#N` prose does not', () => {
    expect(parseDraftChips('fix #12 today', CHIP_FILES)).toHaveLength(0);
    const chips = parseDraftChips('see [#3](todo:t9) ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'todo', id: 't9', label: '#3' });
  });

  test('bare file paths (whitespace boundary) become chips (C1 positive case)', () => {
    const chips = parseDraftChips('see apps/web/src/ui/button.tsx ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      kind: 'file',
      id: 'apps/web/src/ui/button.tsx',
      label: 'apps/web/src/ui/button.tsx',
    });
  });

  test('in-word substrings do not become chips (C1: left neighbor is not whitespace)', () => {
    expect(parseDraftChips('xapps/web/src/ui/button.tsx ', CHIP_FILES)).toHaveLength(0);
  });

  test('paths outside the roster do not become chips (C1)', () => {
    expect(parseDraftChips('see nope/missing.ts ', CHIP_FILES)).toHaveLength(0);
  });

  test('paths containing spaces become quote-wrapped chips, label dequoted (C2)', () => {
    const chips = parseDraftChips('open "docs/my notes.md" now', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'docs/my notes.md', label: 'docs/my notes.md' });
  });

  test('directory labels with a trailing / become chips (C2)', () => {
    const chips = parseDraftChips('in apps/web/src/ui/ here', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui', label: 'apps/web/src/ui/' });
  });

  test('overlapping hits keep only the longest (C3: short items are blocked out of the boundary by slashes/quotes)', () => {
    const overlapping: FileMentionEntry[] = [
      { path: 'docs/my', type: 'blob' },
      { path: 'docs/my notes.md', type: 'blob' },
    ];
    const chips = parseDraftChips('open "docs/my notes.md" now', overlapping);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ id: 'docs/my notes.md' });
  });

  test('attachment tokens do not become chips (C4)', () => {
    expect(parseDraftChips('![pic](attachment:abc123) ', CHIP_FILES)).toHaveLength(0);
  });

  test('chip rows follow draft order (C5), the same path twice becomes two chips', () => {
    const chips = parseDraftChips(
      'apps/web/src/ui/button.tsx vs [builder](agent:a1) and apps/web/src/ui/button.tsx ',
      CHIP_FILES,
    );
    expect(chips).toHaveLength(3);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui/button.tsx' });
    expect(chips[1]).toMatchObject({ kind: 'agent', id: 'a1' });
    expect(chips[2]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui/button.tsx' });
  });

  test('empty draft / no roster → empty rows (the basis for not mounting strip)', () => {
    expect(parseDraftChips('', CHIP_FILES)).toHaveLength(0);
    expect(parseDraftChips('hi [builder](agent:a1) ')).toHaveLength(1);
    expect(parseDraftChips('see apps/web/src/ui/button.tsx ')).toHaveLength(0);
  });
});

const ROSTER: InlineRosterGroups = {
  agent: [{ id: 'a1', label: 'builder' }],
  todo: [{ id: 't1', label: '#3 fix login', seq: 3 }],
  skill: [{ id: 's1', label: 'review' }],
  project: [{ id: 'p1', label: 'cairn' }],
  machine: [{ id: 'm1', label: 'mea' }],
};

describe('buildInlineRows (#848, R1–R5)', () => {
  test('empty query: five classes + files in assembly order (R1)', () => {
    const rows = buildInlineRows('', ROSTER, [{ path: 'a.ts', type: 'blob' }]);
    expect(rows.map((r) => r.kind)).toEqual(['agent', 'todo', 'skill', 'project', 'machine', 'file']);
    expect(rows[0]).toMatchObject({ kind: 'agent', id: 'a1', label: 'builder' });
    expect(rows[5]).toMatchObject({ kind: 'file', id: 'a.ts', label: 'a.ts' });
  });

  test('query filters across classes: only hit classes remain (R2)', () => {
    const rows = buildInlineRows('rev', ROSTER, [{ path: 'a.ts', type: 'blob' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'skill', id: 's1' });
  });

  test('smart case applies across classes (R3)', () => {
    expect(buildInlineRows('REVIEW', ROSTER)).toHaveLength(0);
    expect(buildInlineRows('review', ROSTER)).toHaveLength(1);
  });

  test('todo rows carry seq (R4)', () => {
    const rows = buildInlineRows('', ROSTER);
    expect(rows[1]).toMatchObject({ kind: 'todo', id: 't1', seq: 3 });
  });

  test('files default = pure five-class face (R5)', () => {
    const rows = buildInlineRows('', ROSTER);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.kind === 'file')).toBe(false);
  });

  test('empty query still caps at 15 (R1: #728 feel unregressed)', () => {
    const big: InlineRosterGroups = {
      agent: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, label: `agent-${i}` })),
      todo: [],
      skill: [],
      project: [],
      machine: [],
    };
    expect(buildInlineRows('', big)).toHaveLength(15);
  });
});
