import { FIXED_TAGS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  buildTagOptions,
  cardTag,
  matchesTagFilter,
  parseTagParam,
} from '../src/board/tag-filter.js';
import type { TagChipData } from '../src/components/ui/tag-chip.js';
import { todo } from './helpers.js';

const NAMES = FIXED_TAGS.map((t) => t.name);

const nameById = new Map(NAMES.map((n) => [`tag-${n}`, n]));

describe('parseTagParam (URL ?tags= parsing)', () => {
  test('missing param/empty string/pure separators = empty selection (F7)', () => {
    expect(parseTagParam(null, NAMES)).toEqual([]);
    expect(parseTagParam('', NAMES)).toEqual([]);
    expect(parseTagParam(',', NAMES)).toEqual([]);
  });

  test('names outside the vocab keep only legal names (F5)', () => {
    expect(parseTagParam('foo,bug', NAMES)).toEqual(['bug']);
    expect(parseTagParam('nope', NAMES)).toEqual([]);
  });

  test('the vocab is dynamic: real labels of the github shape are legal names, only names outside the static table are dropped (F5b)', () => {

    const repoVocab = ['area:web', 'bug', 'needs-triage'];
    expect(parseTagParam('needs-triage,bug', repoVocab)).toEqual(['bug', 'needs-triage']);
    expect(parseTagParam('docs', repoVocab)).toEqual([]);
  });

  test('duplicate names deduped (F6)', () => {
    expect(parseTagParam('bug,bug', NAMES)).toEqual(['bug']);
  });

  test('return order = lexicographic canonical order, independent of param write order (F8)', () => {
    expect(parseTagParam('docs,bug', NAMES)).toEqual(['bug', 'docs']);
    expect(parseTagParam('refactor,chore,bug', NAMES)).toEqual(['bug', 'chore', 'refactor']);
  });

  test('vocab not ready (vocab = null) = empty set, unknown names not read as live selections (F9)', () => {
    expect(parseTagParam('bug', null)).toEqual([]);
    expect(parseTagParam('bug', [])).toEqual([]);
  });
});

describe('buildTagOptions (XMON-57 dynamic vocab option set)', () => {
  const row = (id: string, name: string, color: string): TagChipData => ({ id, name, color });

  test('same-name dedup, takes the first projected row (the color slot of the lexicographically first project) (O1)', () => {

    const options = buildTagOptions(
      [row('a-bug', 'bug', '#aaa'), row('b-bug', 'bug', '#bbb'), row('b-docs', 'docs', '#ccc')],
      [],
      () => true,
      new Map([
        ['a-bug', 'bug'],
        ['b-bug', 'bug'],
        ['b-docs', 'docs'],
      ]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug', 'docs']);
    expect(options[0]?.color).toBe('#aaa');
  });

  test('option order = lexicographic canonical order (independent of projection write order) (O2)', () => {
    const options = buildTagOptions(
      [row('t-refactor', 'refactor', '#1'), row('t-bug', 'bug', '#2')],
      [],
      () => true,
      new Map([
        ['t-refactor', 'refactor'],
        ['t-bug', 'bug'],
      ]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug', 'refactor']);
  });

  test('count = hit card count after the other axis narrows; this axis own selection not involved (O3)', () => {
    const bugged = { ...todo(1, 'todo'), tagIds: ['t-bug'] };
    const docced = { ...todo(2, 'todo'), tagIds: ['t-docs'] };
    const untagged = todo(3, 'todo');
    const ordered = [row('t-bug', 'bug', '#f00'), row('t-docs', 'docs', '#0f0')];
    const ids = new Map([
      ['t-bug', 'bug'],
      ['t-docs', 'docs'],
    ]);

    const all = buildTagOptions(ordered, [bugged, docced, untagged], () => true, ids);
    expect(all.map((o) => o.count)).toEqual([1, 1]);

    const narrowed = buildTagOptions(
      ordered,
      [bugged, docced, untagged],
      (t) => t.id === docced.id,
      ids,
    );
    expect(narrowed.map((o) => o.count)).toEqual([0, 1]);

    expect(all.reduce((sum, o) => sum + o.count, 0)).toBe(2);
  });

  test('tagIds outside the vocab do not count and do not fabricate options (O4)', () => {
    const stale = { ...todo(1, 'todo'), tagIds: ['t-gone'] };
    const options = buildTagOptions(
      [row('t-bug', 'bug', '#f00')],
      [stale],
      () => true,
      new Map([['t-gone', 'ghost']]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug']);
    expect(options[0]?.count).toBe(0);
  });

  test('empty projection = empty options (vocab not ready / no tag face in scope)', () => {
    expect(buildTagOptions([], [todo(1, 'todo')], () => true, new Map())).toEqual([]);
  });
});

describe('matchesTagFilter (hit judgment, OR + untagged always visible)', () => {
  const bugged = { ...todo(1, 'todo'), tagIds: ['tag-bug'] };
  const docced = { ...todo(2, 'todo'), tagIds: ['tag-docs'] };
  const plain = todo(3, 'todo');

  test('empty selected set = full set visible (F4)', () => {
    for (const t of [bugged, docced, plain]) {
      expect(matchesTagFilter(t, new Set(), nameById)).toBe(true);
    }
  });

  test('untagged tasks always visible under any non-empty filter (F1)', () => {
    expect(matchesTagFilter(plain, new Set(['bug']), nameById)).toBe(true);
    expect(matchesTagFilter(plain, new Set(NAMES), nameById)).toBe(true);
  });

  test('single-select narrows: cards matching the selected name visible, other tagged cards hidden (F2 base)', () => {
    const sel = new Set(['bug']);
    expect(matchesTagFilter(bugged, sel, nameById)).toBe(true);
    expect(matchesTagFilter(docced, sel, nameById)).toBe(false);
  });

  test('multi-select = OR union, not intersection (F2)', () => {
    const sel = new Set(['bug', 'docs']);
    expect(matchesTagFilter(bugged, sel, nameById)).toBe(true);
    expect(matchesTagFilter(docced, sel, nameById)).toBe(true);
  });

  test('unparseable tagId (dirty data/race) hits nothing, mis-matches nothing (F3)', () => {
    const stale = { ...todo(4, 'todo'), tagIds: ['tag-deleted'] };
    expect(matchesTagFilter(stale, new Set(['bug']), nameById)).toBe(false);

    const mixed = { ...todo(5, 'todo'), tagIds: ['tag-deleted', 'tag-bug'] };
    expect(matchesTagFilter(mixed, new Set(['bug']), nameById)).toBe(true);
  });

  test('when nameById is absent, tagged cards hit nothing (first-load-not-ready defensive face)', () => {
    expect(matchesTagFilter(bugged, new Set(['bug']), new Map())).toBe(false);
    expect(matchesTagFilter(plain, new Set(['bug']), new Map())).toBe(true);
  });
});

describe('cardTag (#445 card tag parsing, tagId → render row)', () => {
  const tagById = new Map<string, TagChipData>(
    NAMES.map((n) => [`tag-${n}`, { id: `tag-${n}`, name: n, color: `#${n}` }]),
  );

  test('parseable tagId → that tag row (name+color for TagChip rendering)', () => {
    const bugged = { ...todo(1, 'todo'), tagIds: ['tag-bug'] };
    expect(cardTag(bugged, tagById)).toEqual({ id: 'tag-bug', name: 'bug', color: '#bug' });
  });

  test('untagged = null (card renders no placeholder, C1)', () => {
    expect(cardTag(todo(2, 'todo'), tagById)).toBeNull();
  });

  test('dirty/not-ready tagId = null degrades gracefully, mis-matches nothing (C2)', () => {
    const stale = { ...todo(3, 'todo'), tagIds: ['tag-deleted'] };
    expect(cardTag(stale, tagById)).toBeNull();
    expect(cardTag(stale, new Map())).toBeNull();
  });

  test('multi-tag takes only the first parseable item = render cap (C3); dirty ids mixed in skip subsequent parsing', () => {
    const multi = { ...todo(4, 'todo'), tagIds: ['tag-bug', 'tag-docs'] };
    expect(cardTag(multi, tagById)?.name).toBe('bug');
    const dirtyFirst = { ...todo(5, 'todo'), tagIds: ['tag-deleted', 'tag-docs'] };
    expect(cardTag(dirtyFirst, tagById)?.name).toBe('docs');
  });
});
