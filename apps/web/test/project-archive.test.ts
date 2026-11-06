import { expect, test } from 'vitest';
import { splitProjectsByArchive } from '../src/board/project-archive.js';

const projects = [
  { id: 'a', archivedAt: null },
  { id: 'b', archivedAt: 5 },
  { id: 'c' },
];

test('archived projects leave the active list and stay reachable in the archived list', () => {
  const { active, archived } = splitProjectsByArchive(projects);
  expect(active.map((p) => p.id)).toEqual(['a', 'c']);
  expect(archived.map((p) => p.id)).toEqual(['b']);
});

test('splitting never drops a project', () => {
  const { active, archived } = splitProjectsByArchive(projects);
  expect(active.length + archived.length).toBe(projects.length);
});

test('unarchiving moves a project back to the active list', () => {
  const { active } = splitProjectsByArchive(projects.map((p) => ({ ...p, archivedAt: null })));
  expect(active.map((p) => p.id)).toEqual(['a', 'b', 'c']);
});
