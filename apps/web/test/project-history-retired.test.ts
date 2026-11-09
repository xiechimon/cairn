import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const page = readFileSync(fileURLToPath(new URL('../src/pages/project-page.tsx', import.meta.url)), 'utf8');

test('project browsing does not mount commit history or a commit diff viewer', () => {
  expect(page).not.toMatch(/useProjectCommits|useProjectCommitDetail|CommitDetailView|prj-history-row/);
  expect(page).not.toContain("label: t('历史')");
});
