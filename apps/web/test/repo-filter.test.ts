import { describe, expect, test } from 'vitest';
import { buildRepoOptions, matchesProjectFilter, parseProjectsParam } from '../src/board/repo-filter.js';
import { todo } from './helpers.js';

const inProject = (projectId: string) => ({ ...todo(1, 'todo'), projectId });

describe('parseProjectsParam (URL ?projects= parsing)', () => {
  test('missing param/empty string/pure separators = empty selection (R1)', () => {
    expect(parseProjectsParam(null)).toEqual([]);
    expect(parseProjectsParam('')).toEqual([]);
    expect(parseProjectsParam(',')).toEqual([]);
  });

  test('duplicate ids deduped (R2)', () => {
    expect(parseProjectsParam('p1,p1')).toEqual(['p1']);
  });

  test('return order = lexicographic canonical order, independent of param write order (R3)', () => {
    expect(parseProjectsParam('zb,ma,ma,ab')).toEqual(['ab', 'ma', 'zb']);
  });
});

describe('matchesProjectFilter (hit judgment, exact set membership + OR union)', () => {
  const a = inProject('p-a');
  const b = inProject('p-b');

  test('empty selected set = full set visible (R4)', () => {
    expect(matchesProjectFilter(a, new Set())).toBe(true);
    expect(matchesProjectFilter(b, new Set())).toBe(true);
  });

  test('single-select narrows: cards of selected items visible, rest hidden (R5)', () => {
    const sel = new Set(['p-a']);
    expect(matchesProjectFilter(a, sel)).toBe(true);
    expect(matchesProjectFilter(b, sel)).toBe(false);
  });

  test('multi-select = OR union (R6)', () => {
    const sel = new Set(['p-a', 'p-b']);
    expect(matchesProjectFilter(a, sel)).toBe(true);
    expect(matchesProjectFilter(b, sel)).toBe(true);
  });

  test('unknown id (deleted project/dirty URL) hits no card (R7)', () => {
    expect(matchesProjectFilter(a, new Set(['p-gone']))).toBe(false);

    expect(matchesProjectFilter(a, new Set(['p-gone', 'p-a']))).toBe(true);
    expect(matchesProjectFilter(b, new Set(['p-gone', 'p-a']))).toBe(false);
  });
});

describe('buildRepoOptions (XMON-57 option set and counts)', () => {
  const entries = [
    { id: 'p-a', name: 'A' },
    { id: 'p-b', name: 'B' },
    { id: 'p-quiet', name: 'Quiet' },
  ];
  const todos = [
    { ...todo(1, 'todo'), projectId: 'p-a' },
    { ...todo(2, 'todo'), projectId: 'p-b' },
    { ...todo(3, 'todo'), projectId: 'p-b' },
  ];

  test('row order = source order (projects have no static total order, none imposed here)', () => {
    expect(buildRepoOptions(entries, todos, () => true).map((o) => o.id)).toEqual([
      'p-a',
      'p-b',
      'p-quiet',
    ]);
  });

  test('count = card count after the other axis narrows; this axis itself not involved, zero-card projects count 0', () => {
    expect(buildRepoOptions(entries, todos, () => true).map((o) => o.count)).toEqual([1, 2, 0]);
    expect(
      buildRepoOptions(entries, todos, (t) => t.projectId === 'p-b').map((o) => o.count),
    ).toEqual([0, 2, 0]);
  });

  test('no project source in scope = empty options (the panel renders an empty-state row, not disappears)', () => {
    expect(buildRepoOptions([], todos, () => true)).toEqual([]);
  });
});
