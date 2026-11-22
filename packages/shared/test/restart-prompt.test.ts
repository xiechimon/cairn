import { describe, expect, test } from 'vitest';
import {
  buildRestartPrompt,
  buildTaskPromptText,
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
