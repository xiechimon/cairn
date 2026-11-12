import { expect, test } from 'vitest';
import {
  isProjectFilter,
  projectStatuses,
  sidebarProjects,
  waitingProjectIds,
} from '../src/board/sidebar-projects.js';
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

test('the archived filter lists only archived projects, grouped like active ones', () => {
  const layout = sidebarProjects(
    [
      project('cairn'),
      project('landing', { archivedAt: 1 }),
      project('acme-v1', { group: '客户', archivedAt: 2 }),
      project('acme-web', { group: '客户' }),
    ],
    'archived',
  );
  expect(names(layout.ungrouped)).toEqual(['landing']);
  expect(layout.groups.map((group) => [group.name, names(group.projects)])).toEqual([
    ['客户', ['acme-v1']],
  ]);
});

test('the all filter keeps active and archived projects in their places', () => {
  const layout = sidebarProjects(
    [
      project('cairn'),
      project('landing', { archivedAt: 1 }),
      project('acme-v1', { group: '客户', archivedAt: 2 }),
      project('acme-web', { group: '客户' }),
    ],
    'all',
  );
  expect(names(layout.ungrouped)).toEqual(['cairn', 'landing']);
  expect(layout.groups.map((group) => [group.name, names(group.projects)])).toEqual([
    ['客户', ['acme-v1', 'acme-web']],
  ]);
});

test('only the three filter names are filters', () => {
  expect(['active', 'archived', 'all'].every(isProjectFilter)).toBe(true);
  expect([null, '', 'Archived', 'done'].some(isProjectFilter)).toBe(false);
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

const at = (seq: number, projectId: string, section: TaskSection, phaseAt: number): TaskEntry => ({
  todo: { ...todo(seq, section === 'needs_input' ? 'confirm' : 'building'), projectId, phaseAt },
  section,
});

test('a drawer row status is the newest waiting reason, else how many are working, else none', () => {
  const view: TasksView = {
    entries: [
      at(1, 'cairn', 'ready_for_review', 100),
      at(2, 'cairn', 'needs_input', 300),
      at(3, 'cairn', 'working', 900),
      at(4, 'sandbox', 'working', 10),
      at(5, 'sandbox', 'working', 20),
      at(6, 'quiet', 'up_next', 30),
      at(7, 'quiet', 'resolved', 40),
    ],
    questions: [
      { requestId: 'q1', threadId: null, header: 'Which?', createdAt: 200, projectId: 'cairn' },
      { requestId: 'q2', threadId: null, header: 'Keep it?', createdAt: 50, projectId: 'probe' },
    ],
  };
  const statuses = projectStatuses(view);
  expect(statuses.get('cairn')).toEqual({ kind: 'waiting', word: '待回答', what: { key: '计划写好了' } });
  expect(statuses.get('probe')).toEqual({
    kind: 'waiting',
    word: '待回答',
    what: { key: 'Coordinator 建任务前先问你' },
  });
  expect(statuses.get('sandbox')).toEqual({ kind: 'working', count: 2 });
  expect(statuses.has('quiet')).toBe(false);
});
