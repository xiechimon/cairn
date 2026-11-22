import { describe, expect, test } from 'vitest';
import {
  appendConfirmedPlanNote,
  buildConfirmedPlanNote,
  buildTaskPromptText,
} from '../src/records/prompts.js';

const TITLE = '方案位置探针';
const SPEC = '降级后的执行步要读到本机已确认的方案。';
const TASK_TEXT = buildTaskPromptText(TITLE, SPEC);
const PLAN_FILE = '/home/u/.cairn/plans/conv-1/plan.md';
const NOTE = buildConfirmedPlanNote(PLAN_FILE);

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
