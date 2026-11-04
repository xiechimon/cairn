import { describe, expect, test } from 'vitest';
import {
  appendPlanLocationNote,
  appendWorkBranchNote,
  buildRestartPrompt,
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  classifyUserText,
  composeTaskPromptWithInstruction,
  RESTART_FEEDBACK_MAX_CHARS,
} from '../src/records/prompts.js';

const TITLE = '重启探针';
const SPEC = '第一轮会失败，重启轮要带上反馈。';
const TASK_TEXT = buildTaskPromptText(TITLE, SPEC);

describe('buildRestartPrompt truncation (failure modes 2/3)', () => {
  test('short-feedback base shape unchanged (HEAD + original + TAIL, zero regression on existing contract)', () => {
    const prompt = buildRestartPrompt('把测试也补上');
    expect(prompt).toContain('把测试也补上');
    expect(prompt.startsWith('上一轮执行失败。用户反馈：「')).toBe(true);
    expect(
      prompt.endsWith(
        '」。请把反馈纳入本轮：涉及方案先输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），再忠实执行完成任务。',
      ),
    ).toBe(true);
  });

  test('over-long feedback truncated to the cap: embedded copy <= 4000 + truncation marker, HEAD/TAIL shape preserved', () => {
    const feedback = '返'.repeat(RESTART_FEEDBACK_MAX_CHARS + 500);
    const prompt = buildRestartPrompt(feedback);
    expect(prompt.startsWith('上一轮执行失败。用户反馈：「')).toBe(true);
    expect(
      prompt.endsWith(
        '」。请把反馈纳入本轮：涉及方案先输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），再忠实执行完成任务。',
      ),
    ).toBe(true);
    expect(prompt).toContain('反馈过长，已截断');
    const embedded = prompt.slice('上一轮执行失败。用户反馈：「'.length);
    expect(embedded.startsWith('返'.repeat(RESTART_FEEDBACK_MAX_CHARS))).toBe(true);
    expect(embedded.length).toBeLessThan(feedback.length);
  });

  test('truncation never splits a surrogate pair (falls back one unit when an emoji lands on the boundary)', () => {
    const feedback = `${'a'.repeat(3999)}😀${'b'.repeat(10)}`;
    const prompt = buildRestartPrompt(feedback);
    expect(prompt).not.toContain('😀');
    expect(prompt).toContain('a'.repeat(3999));
  });
});

describe('composeTaskPromptWithInstruction (failure mode 1)', () => {
  test('task text first, instruction last, blank line separated (ruling single-source shape)', () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, instruction);
    expect(composed).toBe(`${TASK_TEXT}\n\n${instruction}`);
    expect(composed.startsWith(TASK_TEXT)).toBe(true);
    expect(composed.endsWith(instruction)).toBe(true);
  });
});

describe('classifyUserText combined-line recognition (failure modes 4/5)', () => {
  const task = { title: TITLE, spec: SPEC };

  test('bare task text -> task-prompt (existing contract regression pin)', () => {
    expect(classifyUserText(TASK_TEXT.trim(), task)).toBe('task-prompt');
  });

  test('bare restart instruction -> synthetic (existing contract regression pin)', () => {
    expect(classifyUserText(buildRestartPrompt('x'), task)).toBe('synthetic');
  });

  test('combined line (task prefix + restart instruction remainder) -> synthetic whole line exits', () => {
    const composed = composeTaskPromptWithInstruction(
      TASK_TEXT,
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('combined line (truncated restart instruction remainder) -> synthetic (truncation does not break recognition)', () => {
    const instruction = buildRestartPrompt('返'.repeat(RESTART_FEEDBACK_MAX_CHARS + 100));
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, instruction);
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('combined line (task prefix + CONTINUE instruction remainder) -> synthetic (general synthesis surface)', () => {
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, CONTINUE_PROMPTS.plan);
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test("task prefix + user's own words -> user (no false kills)", () => {
    const text = `${TASK_TEXT}\n\n另外移动端也要看一眼`;
    expect(classifyUserText(text.trim(), task)).toBe('user');
  });

  test('feedback text -> user (real user lines unaffected by combined-line recognition)', () => {
    expect(classifyUserText('把测试也补上', task)).toBe('user');
  });

  test('combined line (task title drifted) -> synthetic', () => {
    const composed = composeTaskPromptWithInstruction(
      buildTaskPromptText('漂移前标题', SPEC),
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('combined line (spec drifted) -> synthetic', () => {
    const composed = composeTaskPromptWithInstruction(
      buildTaskPromptText(TITLE, '旧版目标，句号收尾。'),
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('drifted combined lines with work-branch note / plan handoff note at the tail still synthetic', () => {
    const base = composeTaskPromptWithInstruction(
      buildTaskPromptText('漂移前标题', SPEC),
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(appendWorkBranchNote(base, 'cairn/conv-1279').trim(), task)).toBe(
      'synthetic',
    );
    expect(
      classifyUserText(
        appendPlanLocationNote(base, '/tmp/cairn/plans/conv-1279/plan.md').trim(),
        task,
      ),
    ).toBe('synthetic');
  });

  test('drifted bare task text (no restart instruction) is still user', () => {
    const stale = buildTaskPromptText('漂移前标题', SPEC).trim();
    expect(classifyUserText(stale, task)).toBe('user');
  });

  test('user text containing a restart header but not matching the template -> user', () => {
    const text = '看这段\n\n上一轮执行失败。用户反馈：「还没写完';
    expect(classifyUserText(text, task)).toBe('user');
  });
});
