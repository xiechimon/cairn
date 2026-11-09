import type { MemoryRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { isAutoInjected, memorySections, splitMemoryContent } from '../src/chief/memory-list.js';

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

test('team comes first only when it has memories, then every project, then removed projects', () => {
  const sections = memorySections(
    [memory('a', 'p2'), memory('b', null), memory('c', 'p2', 'searchable'), memory('d', 'gone')],
    [
      { id: 'p1', name: 'Field Notes' },
      { id: 'p2', name: 'Harbor API' },
    ],
  );
  expect(
    sections.map((section) => [
      section.key,
      section.scope,
      section.projectName,
      section.injected.map((row) => row.id),
      section.lookup.map((row) => row.id),
    ]),
  ).toEqual([
    ['team', 'team', null, ['b'], []],
    ['p1', 'project', 'Field Notes', [], []],
    ['p2', 'project', 'Harbor API', ['a'], ['c']],
    ['gone', 'unknown-project', null, ['d'], []],
  ]);
});

test('no team section without team memories', () => {
  expect(memorySections([memory('a', 'p1')], [{ id: 'p1', name: 'Field Notes' }]).map((s) => s.key)).toEqual([
    'p1',
  ]);
  expect(memorySections([], [])).toEqual([]);
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
