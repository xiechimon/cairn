import { describe, expect, test } from 'vitest';
import {
  appendConfirmedPlanNote,
  appendWorkBranchNote,
  buildConfirmedPlanNote,
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  classifyUserText,
} from '../src/records/prompts.js';

const TITLE = '方案位置探针';
const SPEC = '降级后的执行步要读到本机已确认的方案。';
const TASK_TEXT = buildTaskPromptText(TITLE, SPEC);
const PLAN_FILE = '/home/u/.cairn/plans/conv-1/plan.md';
const NOTE = buildConfirmedPlanNote(PLAN_FILE);
const BRANCH = 'cairn/conv-1';

describe('note assembly', () => {
  test('shape: head marker + absolute path + trailing constraint', () => {
    expect(NOTE.startsWith('已确认方案位置：')).toBe(true);
    expect(NOTE).toContain(PLAN_FILE);
    expect(NOTE).toContain('不要改写它');
  });

  test('append = single newline, and idempotent', () => {
    const once = appendConfirmedPlanNote(TASK_TEXT, PLAN_FILE);
    expect(once).toBe(`${TASK_TEXT}\n${NOTE}`);
    expect(appendConfirmedPlanNote(once, PLAN_FILE)).toBe(once);
  });
});

describe('classifyUserText confirmed-plan location lines', () => {
  const task = { title: TITLE, spec: SPEC };

  test('task text + location line -> task-prompt', () => {
    expect(classifyUserText(`${TASK_TEXT}\n${NOTE}`.trim(), task)).toBe('task-prompt');
  });

  test('location line plus work-branch note -> task-prompt', () => {
    const composed = appendWorkBranchNote(`${TASK_TEXT}\n${NOTE}`, BRANCH);
    expect(classifyUserText(composed.trim(), task)).toBe('task-prompt');
  });

  test('continuation placeholder + location line -> synthetic', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.build}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('user text with a location line at the end -> user', () => {
    expect(classifyUserText(`另外移动端也要看一眼\n${NOTE}`.trim(), task)).toBe('user');
  });
});
