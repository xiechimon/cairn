import { parseSearchQuery } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  type ActivityRow,
  activityRows,
  activityTotalCost,
  activityTodosForHits,
  groupByDay,
  ACTIVITY_PAGE_SIZE,
  pageRows,
  searchTodosLocally,
} from '../src/search/activity-model.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOON = new Date(2026, 10, 4, 12).getTime();

function row(id: string, ageMs: number, cost: number | null): ActivityRow {
  return {
    id,
    todo: { ...todo(1, 'done'), id, phaseAt: NOON - ageMs },
    projectName: 'cairn',
    cost,
  };
}

describe('groupByDay', () => {
  test('rows land in today, yesterday, earlier this week and older by calendar day', () => {
    const groups = groupByDay(
      [
        row('a', HOUR, 1),
        row('b', 11 * HOUR, 1),
        row('c', 13 * HOUR, 2),
        row('d', 2 * DAY, 4),
        row('e', 20 * DAY, 8),
      ],
      NOON,
    );
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([
      ['today', ['a', 'b']],
      ['yesterday', ['c']],
      ['week', ['d']],
      ['older', ['e']],
    ]);
  });

  test('the viewer local midnight separates today from yesterday', () => {
    const now = new Date(2026, 10, 2, 0, 30).getTime();
    const rows = [
      { ...row('today', 0, 0), todo: { ...todo(1, 'done'), phaseAt: new Date(2026, 10, 2, 0, 15).getTime() } },
      { ...row('yesterday', 0, 0), todo: { ...todo(2, 'done'), phaseAt: new Date(2026, 10, 1, 23, 30).getTime() } },
    ];
    expect(groupByDay(rows, now).map((group) => [group.id, group.rows.map((item) => item.id)])).toEqual([
      ['today', ['today']],
      ['yesterday', ['yesterday']],
    ]);
  });

  test('a Monday starts a new week instead of including six prior days', () => {
    const now = new Date(2026, 10, 9, 12).getTime();
    const rows = [9, 8, 7, 4].map((day) => ({
      ...row(`day-${day}`, 0, 0),
      todo: { ...todo(day, 'done'), phaseAt: new Date(2026, 10, day, 10).getTime() },
    }));
    expect(groupByDay(rows, now).map((group) => [group.id, group.rows.map((item) => item.id)])).toEqual([
      ['today', ['day-9']],
      ['yesterday', ['day-8']],
      ['older', ['day-7', 'day-4']],
    ]);
  });

  test('yesterday uses its local calendar date across a daylight-saving transition', () => {
    const now = new Date(2026, 10, 2, 0, 30).getTime();
    const previous = { ...row('previous-midnight', 0, 0), todo: { ...todo(1, 'done'), phaseAt: new Date(2026, 10, 1, 0, 15).getTime() } };
    expect(groupByDay([previous], now).map((group) => group.id)).toEqual(['yesterday']);
  });

  test('a mixed-price group retains its count and unknown-cost diagnostic', () => {
    const [today] = groupByDay([row('a', HOUR, 1.5), row('b', 2 * HOUR, 0.25), row('c', 3 * HOUR, null)], NOON);
    expect(today?.count).toBe(3);
    expect(today?.cost).toBeNull();
    expect(today?.unpriced).toBe(1);
  });

  test('rows inside a group are newest first and empty groups are omitted', () => {
    const groups = groupByDay([row('old', 5 * HOUR, 0), row('new', HOUR, 0)], NOON);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  test('no rows, no groups', () => {
    expect(groupByDay([], NOON)).toEqual([]);
  });
});

describe('activityTotalCost', () => {
  test.each([
    { name: 'all unknown', costs: [null, null], total: null },
    { name: 'mixed known and unknown', costs: [1.5, null, 0.25], total: null },
    { name: 'known free', costs: [0, 0], total: 0 },
    { name: 'all priced', costs: [1.5, 0.25], total: 1.75 },
    { name: 'empty', costs: [], total: 0 },
  ])('$name totals stay equally truthful for the page and group', ({ costs, total }) => {
    const rows = costs.map((cost, i) => row(`cost-${i}`, HOUR, cost));
    expect(activityTotalCost(rows)).toBe(total);
    if (rows.length > 0) expect(groupByDay(rows, NOON)[0]?.cost).toBe(total);
  });

  test('wire partial metadata wins over a positive subtotal while explicitly priced zero is known', () => {
    const rows = activityRows([
      { ...todo(1, 'done'), usageCost: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2, priced: false } },
      { ...todo(2, 'done'), usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: true } },
    ], () => 'cairn');
    expect(rows.map((row) => row.cost)).toEqual([null, 0]);
    expect(activityTotalCost(rows)).toBeNull();
    expect(activityTotalCost(rows.slice(1))).toBe(0);
  });
});

describe('pageRows', () => {
  const rows = Array.from({ length: ACTIVITY_PAGE_SIZE * 2 + 3 }, (_, i) => row(`r${i}`, i * HOUR, 0));

  test('shows one page at first and more on each step', () => {
    expect(pageRows(rows, 1)).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(pageRows(rows, 2)).toHaveLength(ACTIVITY_PAGE_SIZE * 2);
    expect(pageRows(rows, 3)).toHaveLength(rows.length);
  });

  test('pages are taken from the newest end', () => {
    expect(pageRows(rows, 1)[0]?.id).toBe('r0');
  });
});

describe('activityTodosForHits', () => {
  test('View all counts only hits that Activity can display, including fixture archive state', () => {
    const active = { ...todo(1, 'done'), id: 'active' };
    const archived = { ...todo(2, 'done'), id: 'archived', archivedAt: NOW };
    const hits = [{ id: 'archived' }, { id: 'missing-from-current-team' }, { id: 'active' }];
    const matched = activityTodosForHits(hits, [archived, active]);
    expect(matched).toEqual([active]);
    expect(matched.length).toBe(activityRows(matched, () => 'cairn').length);
  });

  test('an archived-only live hit has no Activity count when todos exclude it', () => {
    expect(activityTodosForHits([{ id: 'archived' }], [todo(1, 'done')])).toEqual([]);
  });

  test('matched records retain search order and their full Activity detail', () => {
    const first = { ...todo(1, 'failed'), id: 'first' };
    const second = { ...todo(2, 'done'), id: 'second', usageCost: { total: 2.5, priced: true, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
    expect(activityTodosForHits([{ id: 'second' }, { id: 'first' }], [first, second])).toEqual([second, first]);
  });
});

describe('activityRows', () => {
  test('cost is unknown when the thread has no priced usage', () => {
    const base = todo(1, 'done');
    const rows = activityRows(
      [
        { ...base, id: 'a', usageCost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2.5, priced: true } },
        { ...base, id: 'b', usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: false } },
        { ...base, id: 'c' },
      ],
      () => 'cairn',
    );
    expect(rows.map((r) => r.cost)).toEqual([2.5, null, null]);
    expect(rows.map((r) => r.projectName)).toEqual(['cairn', 'cairn', 'cairn']);
  });

  test('archived threads are left out', () => {
    const archived: TodoRecord = { ...todo(2, 'done'), archivedAt: NOW };
    expect(activityRows([archived, todo(3, 'done')], () => 'cairn')).toHaveLength(1);
  });
});

describe('searchTodosLocally', () => {
  const projects = new Map([
    ['p1', 'cairn'],
    ['p2', 'docs-site'],
  ]);
  const make = (id: string, phase: TodoRecord['phase'], projectId: string, ageMs: number, total?: number): TodoRecord => ({
    ...todo(1, phase),
    id,
    title: `title ${id}`,
    projectId,
    phaseAt: NOON - ageMs,
    ...(total === undefined
      ? {}
      : { usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total, priced: true } }),
  });
  const todos = [
    make('failed-cairn', 'failed', 'p1', HOUR, 3),
    make('failed-docs', 'failed', 'p2', 2 * HOUR, 0.5),
    make('review-cairn', 'review', 'p1', 10 * DAY, 9),
    make('done-cairn', 'done', 'p1', DAY, 1),
  ];
  const ids = (query: string) => {
    const result = searchTodosLocally(todos, (id) => projects.get(id), parseSearchQuery(query, NOON));
    return result.todos.map((t) => t.id);
  };
  const search = (query: string) =>
    searchTodosLocally(todos, (id) => projects.get(id), parseSearchQuery(query, NOON));

  test('is: maps to phases', () => {
    expect(ids('is:failed')).toEqual(['failed-cairn', 'failed-docs']);
    expect(ids('is:waiting')).toEqual(['review-cairn']);
    expect(ids('is:done')).toEqual(['done-cairn']);
  });

  test('filters of different keys all apply and the same key is an or', () => {
    expect(ids('is:failed project:cairn')).toEqual(['failed-cairn']);
    expect(ids('is:failed is:done')).toEqual(['failed-cairn', 'failed-docs', 'done-cairn']);
  });

  test('negated filters exclude', () => {
    expect(ids('-is:failed')).toEqual(['review-cairn', 'done-cairn']);
  });

  test('after: and cost: compare against phase time and priced cost', () => {
    expect(ids('after:2d')).toEqual(['failed-cairn', 'failed-docs', 'done-cairn']);
    expect(ids('cost:>2')).toEqual(['failed-cairn', 'review-cairn']);
    expect(ids('cost:<1')).toEqual(['failed-docs']);
  });

  test('cost filters exclude partial positive wire costs and include explicitly priced free usage', () => {
    const records = [
      { ...todo(1, 'done'), id: 'partial', usageCost: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2, priced: false } },
      { ...todo(2, 'done'), id: 'free', usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: true } },
    ];
    expect(searchTodosLocally(records, () => 'cairn', parseSearchQuery('cost:>1', NOON)).todos).toEqual([]);
    expect(searchTodosLocally(records, () => 'cairn', parseSearchQuery('cost:<1', NOON)).todos.map((todo) => todo.id)).toEqual(['free']);
  });

  test('words match titles', () => {
    expect(ids('is:failed docs')).toEqual(['failed-docs']);
  });

  test('an unknown project is reported invalid and matches nothing', () => {
    const result = search('project:nope');
    expect(result.todos).toEqual([]);
    expect(result.filters[0]).toMatchObject({ raw: 'project:nope', valid: false, reason: 'unknown_project' });
  });

  test('a bad value is reported with the parser problem', () => {
    const result = search('cost:lots');
    expect(result.filters[0]).toMatchObject({ valid: false, reason: 'bad_cost' });
    expect(result.todos).toEqual([]);
  });

  test('valid filters are reported valid', () => {
    expect(search('is:failed').filters[0]).toMatchObject({ valid: true });
  });
});
