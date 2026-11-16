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
  const historicalNote = buildWorkBranchNote('lane/1834')
    .split('\n')[0]
    ?.replace('[cairn 系统规则，不是用户的消息]', '');
  expect(stripWorkBranchNote(`task\n${historicalNote}`)).toBe('task');
});

test('the worker rule stops on a duplicate, names the close tool, and skips the check without GitHub access', () => {
  const note = buildWorkBranchNote('lane/1834');
  expect(note).toContain('close_as_duplicate');
  expect(note).toContain('has no GitHub access, skip this check');
  expect(note).not.toContain('If lookup fails or is incomplete, stop creation');
});

test('a prompt stored before the duplicate rule still rewrites to the current note and strips back to the task', () => {
  const current = buildWorkBranchNote('lane/1834');
  const previous = current.replace(
    /If the project has no GitHub access.*?report the number\./,
    'If lookup fails or is incomplete, stop creation and report the error.',
  );
  expect(previous).not.toBe(current);
  expect(stripWorkBranchNote(`task\n${previous}`)).toBe('task');
});
