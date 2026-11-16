import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

test('project files has no route or navigation entry', () => {
  expect(source('App.tsx')).not.toContain("path: '/app/project/:id/files'");
  expect(source('board/home-c.tsx')).not.toMatch(/\/app\/project\/\$\{[^}]+\}\/files/);
});

test('thread file mentions and build-scoped full-file reads remain available', () => {
  expect(source('api/hooks.ts')).toContain('export const useProjectFiles');
  expect(source('api/hooks.ts')).toContain('export const useBuildChangeFile');
  expect(source('board/use-thread-mentions.ts')).toContain('useProjectFiles');
});
