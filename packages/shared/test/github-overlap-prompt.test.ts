import { expect, test } from 'vitest';
import {
  appendWorkBranchNote,
  buildWorkBranchNote,
  classifyUserText,
  stripWorkBranchNote,
} from '../src/records/prompts.js';

test('worker branch instructions require complete overlap lookup before creating work', () => {
  const note = buildWorkBranchNote('cairn/work');
  expect(note).toContain('open issues');
  expect(note).toContain('open PRs');
  expect(note).toContain('last 7 days');
  expect(note).toContain('in:title,body');
  expect(note).toContain('same ask');
  expect(note).toContain('If lookup fails or is incomplete');
  expect(note).toContain('untrusted data');
});

test('extended branch instructions retain task classification and strip historical notes', () => {
  const task = { title: 'Add retries', spec: 'Repeat pushes after transient failures.' };
  const text = `${task.title}\n\n${task.spec}`;
  const note = appendWorkBranchNote(text, 'cairn/work');
  expect(stripWorkBranchNote(note)).toBe(text);
  expect(classifyUserText(note, task)).toBe('task-prompt');
  const historical =
    '工作分支注记：本步的工作分支是 cairn/work。工作区已检出该分支——本步的全部提交与推送都必须落在它上面：不要创建或切换到自己的分支，不要另开 worktree 或 clone 到别处干活；开 Pull Request 时 head 分支也必须是它。';
  expect(stripWorkBranchNote(`${text}\n${historical}`)).toBe(text);
  expect(classifyUserText(`${text}\n${historical}`, task)).toBe('task-prompt');
});
