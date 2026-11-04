import { expect, test } from 'vitest';
import { buildWorkBranchNote, stripWorkBranchNote } from '../src/records/prompts.js';

test('worker instructions require overlap lookup before planning, building, tickets and PRs', () => {
  const note = buildWorkBranchNote('lane/1834');
  expect(note).toContain('github-overlap.mjs');
  expect(note).toContain('last 7 days');
  expect(note).toContain('same ask');
  expect(note).toContain('build on that branch, wait, or proceed with a stated reason');
  expect(stripWorkBranchNote(`task\n${note}`)).toBe('task');
});

test('historical branch notes still strip from stored task prompts', () => {
  const historicalNote = buildWorkBranchNote('lane/1834').split('\n')[0];
  expect(stripWorkBranchNote(`task\n${historicalNote}`)).toBe('task');
});
