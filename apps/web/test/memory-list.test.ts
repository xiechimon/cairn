import type { MemoryRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { isAutoInjected, memoriesByLayer, splitMemoryContent } from '../src/chief/memory-list.js';

const memory = (
  id: string,
  projectId: string | null,
  layer?: MemoryRecord['layer'],
): MemoryRecord => ({
  id,
  agentId: 't1',
  teamId: 't1',
  title: id,
  content: id,
  projectId,
  sourceTodoId: null,
  sourceBuildId: null,
  createdAt: 1,
  updatedAt: 1,
  ...(layer === undefined ? {} : { layer }),
});

test('memories split by scope into injected and lookup lists', () => {
  const memories = [
    memory('a', 'p2'),
    memory('b', null),
    memory('c', 'p2', 'searchable'),
    memory('d', null, 'searchable'),
    memory('e', 'p1'),
  ];
  const ids = (rows: MemoryRecord[]) => rows.map((row) => row.id);
  const team = memoriesByLayer(memories, null);
  expect([ids(team.injected), ids(team.lookup)]).toEqual([['b'], ['d']]);
  const harbor = memoriesByLayer(memories, 'p2');
  expect([ids(harbor.injected), ids(harbor.lookup)]).toEqual([['a'], ['c']]);
  expect(memoriesByLayer([], 'p1')).toEqual({ injected: [], lookup: [] });
});

test('content splits into a one-line summary and every remaining line as a detail', () => {
  expect(
    splitMemoryContent('Run affected tests.\n- unit with --changed\n\n- e2e for UI\nCI runs the rest'),
  ).toEqual({
    summary: 'Run affected tests.',
    details: ['unit with --changed', 'e2e for UI', 'CI runs the rest'],
  });
  expect(splitMemoryContent('  One line only  ')).toEqual({ summary: 'One line only', details: [] });
});

test('only core memories, or rows without a layer, are injected automatically', () => {
  expect(isAutoInjected(undefined)).toBe(true);
  expect(isAutoInjected('core')).toBe(true);
  expect(isAutoInjected('searchable')).toBe(false);
  expect(isAutoInjected('scratchpad')).toBe(false);
});
