import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('project settings has no generic category destination', () => {
  expect(source('pages/project-settings-page.tsx')).not.toMatch(/id:\s*['"]tags['"]/);
});

test('web client has no unused category queries or assignment argument', () => {
  const hooks = source('api/hooks.ts');
  expect(hooks).not.toMatch(/\b(?:useTags|useProjectTags|TagRecord|tagIds)\b/);
  expect(hooks).not.toContain('/tags');
});

test('GitHub issue label queries and chips remain independent', () => {
  expect(source('api/hooks.ts')).toContain('export function useGithubIssues');
  expect(source('pages/github-issues-dialog.tsx')).toContain('<TagChip');
});
