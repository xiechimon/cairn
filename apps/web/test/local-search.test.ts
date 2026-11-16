import { parseSearchQuery } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { TodoRecord } from '../src/fixtures/records.js';
import { searchTodosLocally } from '../src/search/local-search.js';
import { todo } from './helpers.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOON = new Date(2026, 10, 4, 12).getTime();

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

  test('is:waiting includes a task waiting for an answer', () => {
    const asking = [make('asking-cairn', 'needs_input', 'p1', HOUR, 0)];
    const result = searchTodosLocally(asking, (id) => projects.get(id), parseSearchQuery('is:waiting', NOON));
    expect(result.todos.map((t) => t.id)).toEqual(['asking-cairn']);
  });

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
