import { expect, test } from 'vitest';
import { sidebarProjects, waitingProjectIds } from '../src/board/sidebar-projects.js';
import type { TaskEntry, TaskSection, TasksView } from '../src/board/tasks-sections.js';
import { todo } from './helpers.js';

const project = (id: string, extra: { group?: string | null; archivedAt?: number | null } = {}) => ({
  id,
  name: id,
  ...extra,
});

const names = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

test('archived projects never reach the sidebar, grouped or not', () => {
  const layout = sidebarProjects([
    project('cairn'),
    project('pacman-gh-probe', { archivedAt: 1 }),
    project('harbor-eval', { group: '评测', archivedAt: 1 }),
    project('dogfood-sandbox'),
  ]);
  expect(names(layout.ungrouped)).toEqual(['cairn', 'dogfood-sandbox']);
  expect(layout.groups).toEqual([]);
});

test('with no group set the projects are flat and no group header exists', () => {
  const layout = sidebarProjects([project('cairn'), project('dogfood-sandbox', { group: null })]);
  expect(layout.groups).toEqual([]);
  expect(names(layout.ungrouped)).toEqual(['cairn', 'dogfood-sandbox']);
});

test('ungrouped projects come first, then each group in name order', () => {
  const layout = sidebarProjects([
    project('site', { group: 'Side' }),
    project('cairn'),
    project('notes', { group: 'Side' }),
    project('atlas', { group: 'Archive tools' }),
  ]);
  expect(names(layout.ungrouped)).toEqual(['cairn']);
  expect(layout.groups.map((group) => [group.name, names(group.projects)])).toEqual([
    ['Archive tools', ['atlas']],
    ['Side', ['site', 'notes']],
  ]);
});

test('a group whose projects are all archived has no header', () => {
  const layout = sidebarProjects([project('cairn'), project('old', { group: 'Probes', archivedAt: 5 })]);
  expect(layout.groups).toEqual([]);
});

const entry = (seq: number, projectId: string, section: TaskSection): TaskEntry => ({
  todo: { ...todo(seq, 'building'), projectId },
  section,
});

test('a project waits when one of its tasks or questions waits on the owner', () => {
  const view: TasksView = {
    entries: [
      entry(1, 'review', 'ready_for_review'),
      entry(2, 'input', 'needs_input'),
      entry(3, 'busy', 'working'),
      entry(4, 'later', 'up_next'),
      entry(5, 'finished', 'resolved'),
    ],
    questions: [
      { requestId: 'q1', threadId: null, header: 'Which?', createdAt: 0, projectId: 'asked' },
      { requestId: 'q2', threadId: null, header: 'Team-wide?', createdAt: 0, projectId: null },
    ],
  };
  expect([...waitingProjectIds(view)].sort()).toEqual(['asked', 'input', 'review']);
});
