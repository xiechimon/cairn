import type { MemoryRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { groupMemories, isAutoInjected, splitMemoryContent } from '../src/chief/memory-list.js';

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

test('team memories come first, then one group per project in project order', () => {
  const groups = groupMemories(
    [memory('a', 'p2'), memory('b', null), memory('c', 'p1'), memory('d', 'p2')],
    [
      { id: 'p1', name: 'Field Notes' },
      { id: 'p2', name: 'Harbor API' },
    ],
  );
  expect(groups.map((group) => [group.projectName, group.rows.map((row) => row.id)])).toEqual([
    [null, ['b']],
    ['Field Notes', ['c']],
    ['Harbor API', ['a', 'd']],
  ]);
});

test('a memory whose project is not in the list still shows, after the known projects', () => {
  const groups = groupMemories(
    [memory('a', 'gone'), memory('b', 'p1')],
    [{ id: 'p1', name: 'Field Notes' }],
  );
  expect(groups.map((group) => [group.key, group.projectName])).toEqual([
    ['p1', 'Field Notes'],
    ['gone', null],
  ]);
  expect(groups.map((group) => group.scope)).toEqual(['project', 'unknown-project']);
});

test('empty input yields no groups', () => {
  expect(groupMemories([], [])).toEqual([]);
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
  expect(isAutoInjected('log')).toBe(false);
});
