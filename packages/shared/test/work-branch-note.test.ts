import { describe, expect, test } from 'vitest';
import {
  appendWorkBranchNote,
  buildRestartPrompt,
  buildTaskPromptText,
  buildWorkBranchNote,
  CONTINUE_PROMPTS,
  classifyUserText,
  composeTaskPromptWithInstruction,
  stripWorkBranchNote,
} from '../src/records/prompts.js';

const TITLE = '分支契约探针';
const SPEC = '构建步要被告知只在会话分支提交。';
const TASK_TEXT = buildTaskPromptText(TITLE, SPEC);
const BRANCH = 'cairn/conv-0198f6c0-0000-7000-8000-000000000000';
const NOTE = buildWorkBranchNote(BRANCH);

describe('note assembly (failure mode 6)', () => {
  test('note shape: head marker + branch name + hard-constraint tail', () => {
    expect(NOTE.startsWith('工作分支注记：本步的工作分支是 ')).toBe(true);
    expect(NOTE).toContain(BRANCH);
    expect(NOTE).toContain('不要创建或切换');
    expect(NOTE).toContain('head 分支');
  });

  test('append = single newline join (one line at the prompt tail)', () => {
    expect(appendWorkBranchNote(TASK_TEXT, BRANCH)).toBe(`${TASK_TEXT}\n${NOTE}`);
  });

  test('append idempotent: note already present (recover-surface resume prompt) -> original returned, no double note', () => {
    const once = appendWorkBranchNote(TASK_TEXT, BRANCH);
    expect(appendWorkBranchNote(once, BRANCH)).toBe(once);
  });

  test('strip restore: trailing note removed, remainder returned verbatim; non-note endings untouched', () => {
    expect(stripWorkBranchNote(`${TASK_TEXT}\n${NOTE}`)).toBe(TASK_TEXT);
    expect(stripWorkBranchNote(TASK_TEXT)).toBe(TASK_TEXT);
  });
});

describe('classifyUserText note-line recognition (failure modes 1/3/4/5)', () => {
  const task = { title: TITLE, spec: SPEC };

  test('task text + note -> task-prompt (build-step new-session delivery form, no double render)', () => {
    const composed = appendWorkBranchNote(TASK_TEXT, BRANCH);
    expect(classifyUserText(composed.trim(), task)).toBe('task-prompt');
  });

  test('continuation placeholder + note -> synthetic (CONTINUE_PROMPTS.build form)', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.build}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('failed-restart combined line + note -> synthetic (#720 combined shape stacking a note)', () => {
    const composed = appendWorkBranchNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt('别自己开分支')),
      BRANCH,
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test("task prefix + user's own words -> user (no false kills; no-note negative cases do not regress)", () => {
    const text = `${TASK_TEXT}\n\n另外移动端也要看一眼`;
    expect(classifyUserText(text.trim(), task)).toBe('user');
  });

  test('note-shaped trailing line but the remainder is user words -> user (strip only lets template matches through, it is not a synthesis judgment)', () => {
    expect(classifyUserText(`另外移动端也要看一眼\n${NOTE}`.trim(), task)).toBe('user');
  });
});
