// #1312 降级 build 步的已确认方案位置行：自由句拼在任务文本后面时，
// 过滤侧只剥工作分支注记，整行不再等于任务文本，呈现成用户气泡。
// 失败方式枚举先于实现固化：
//   1. 任务文本 + 方案位置行 → 必须仍判 task-prompt
//   2. 方案位置行再叠工作分支注记 → 仍判 task-prompt（两行都是投递尾）
//   3. 续轮占位句 + 方案位置行 → synthetic
//   4. 用户自己的话带同样的尾行形状 → 仍判 user（剥行只放行模板比对）

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
const PLAN_FILE = '/home/u/.pacman/plans/conv-1/plan.md';
const NOTE = buildConfirmedPlanNote(PLAN_FILE);
const BRANCH = 'pacman/conv-1';

describe('注记组装', () => {
  test('形状：头标记 + 绝对路径 + 尾约束', () => {
    expect(NOTE.startsWith('已确认方案位置：')).toBe(true);
    expect(NOTE).toContain(PLAN_FILE);
    expect(NOTE).toContain('不要改写它');
  });

  test('追加 = 单换行，且幂等', () => {
    const once = appendConfirmedPlanNote(TASK_TEXT, PLAN_FILE);
    expect(once).toBe(`${TASK_TEXT}\n${NOTE}`);
    expect(appendConfirmedPlanNote(once, PLAN_FILE)).toBe(once);
  });
});

describe('classifyUserText 已确认方案位置行', () => {
  const task = { title: TITLE, spec: SPEC };

  test('任务文本 + 位置行 → task-prompt', () => {
    expect(classifyUserText(`${TASK_TEXT}\n${NOTE}`.trim(), task)).toBe('task-prompt');
  });

  test('位置行叠工作分支注记 → task-prompt', () => {
    const composed = appendWorkBranchNote(`${TASK_TEXT}\n${NOTE}`, BRANCH);
    expect(classifyUserText(composed.trim(), task)).toBe('task-prompt');
  });

  test('续轮占位句 + 位置行 → synthetic', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.build}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('用户话语带位置行尾 → user', () => {
    expect(classifyUserText(`另外移动端也要看一眼\n${NOTE}`.trim(), task)).toBe('user');
  });
});
