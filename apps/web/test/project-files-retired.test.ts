import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

test('project files has no route or navigation entry', () => {
  expect(source('App.tsx')).not.toContain("path: '/app/project/:id/files'");
  for (const path of ['board/project-home.tsx', 'board/home-c.tsx']) {
    expect(source(path)).not.toMatch(/\/app\/project\/\$\{[^}]+\}\/files/);
  }
});

test('the project file component is removed rather than hidden', () => {
  expect(source('pages/project-page.tsx')).not.toMatch(/FilesPane|useProjectTree|useProjectFile\b|FileViewState/);
  expect(source('pages/project-page.tsx')).toContain('export function ProjectTasksPage');
});

test('thread file mentions and build-scoped full-file reads remain available', () => {
  expect(source('api/hooks.ts')).toContain('export const useProjectFiles');
  expect(source('api/hooks.ts')).toContain('export const useBuildChangeFile');
  expect(source('board/use-thread-mentions.ts')).toContain('useProjectFiles');
});
