import { describe, expect, test } from 'vitest';
import { PLAN_FILE_NAME } from '../src/records/plan.js';
import {
  appendPlanLocationNote,
  buildPlanFirstRoundInstruction,
  buildPlanLocationNote,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildRestartPrompt,
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  classifyUserText,
  composeTaskPromptWithInstruction,
} from '../src/records/prompts.js';

const TITLE = '契约探针';
const SPEC = '首轮规划要被告知 plan.md 契约。';
const TASK_TEXT = buildTaskPromptText(TITLE, SPEC);
const CONTRACT = buildPlanFirstRoundInstruction();
const REWRITE = buildPlanRewritePrompt();
const PLAN_FILE = '/home/u/.cairn/plans/0198f6c0-0000-7000-8000-000000000000/plan.md';
const NOTE = buildPlanLocationNote(PLAN_FILE);

describe('contract text location-agnostic (failure mode 1)', () => {
  test('first-round contract contains file name + four section names + handoff-location reference; no longer points at the workspace root', () => {
    expect(CONTRACT).toContain(PLAN_FILE_NAME);
    expect(CONTRACT).toContain('交接位置');
    expect(CONTRACT).toContain('（覆盖 Context/Changes/Edge cases/Verification 四段）');
    expect(CONTRACT).not.toContain('工作区根目录');
  });

  test('rewrite instruction follows the same rule (error-round template leaves no workspace-root residue)', () => {
    expect(REWRITE).toContain(PLAN_FILE_NAME);
    expect(REWRITE).toContain('交接位置');
    expect(REWRITE).not.toContain('工作区根目录');
  });
});

describe('handoff location line (#1203 assembly/append single source)', () => {
  test('location line shape: head marker + path + out-of-repo constraint (the anchor for filter-side strip)', () => {
    expect(NOTE.startsWith(`${PLAN_FILE_NAME} 交接位置：`)).toBe(true);
    expect(NOTE).toContain(PLAN_FILE);
    expect(NOTE).toContain('仓库检出之外');
    expect(NOTE).toContain('git add');
  });

  test('append = single newline join (one line at the prompt tail)', () => {
    expect(appendPlanLocationNote(REWRITE, PLAN_FILE)).toBe(`${REWRITE}\n${NOTE}`);
  });

  test('append idempotent: note already present (recover-surface resume prompt) -> original returned, no double note', () => {
    const once = appendPlanLocationNote(REWRITE, PLAN_FILE);
    expect(appendPlanLocationNote(once, PLAN_FILE)).toBe(once);
  });
});

describe('contract combined shape (failure mode 6)', () => {
  test('task text first, contract last, blank line separated (compose single-source shape)', () => {
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT);
    expect(composed).toBe(`${TASK_TEXT}\n\n${CONTRACT}`);
    expect(composed.startsWith(TASK_TEXT)).toBe(true);
    expect(composed.endsWith(CONTRACT)).toBe(true);
  });
});

describe('classifyUserText note-line recognition (failure modes 2/4/5)', () => {
  const task = { title: TITLE, spec: SPEC };

  test('combined line + note -> synthetic whole line exits (first-round plan-step delivery form)', () => {
    const composed = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT),
      PLAN_FILE,
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('bare contract instruction + note -> synthetic', () => {
    expect(classifyUserText(`${CONTRACT}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('rewrite instruction + note -> synthetic (continuation-round instruction single-line form)', () => {
    expect(classifyUserText(`${REWRITE}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('continuation placeholder + note -> synthetic (CONTINUE_PROMPTS.plan form)', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.plan}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('rejection restart + note -> synthetic (wrappedBy family stacking a note)', () => {
    expect(classifyUserText(`${buildReplanPrompt('太重了')}\n${NOTE}`.trim(), task)).toBe(
      'synthetic',
    );
  });

  test('failed-restart combined line + note -> synthetic (#720 combined shape stacking a note)', () => {
    const composed = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt('把测试也补上')),
      PLAN_FILE,
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
