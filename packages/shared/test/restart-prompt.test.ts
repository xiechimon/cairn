// #720 重启轮「指令 + 任务文本」合成族：new session 的 wire prompt 必须同时
// 携任务语境与反馈指令（裁决正本 = issue #720 裁决评论）。外部行为 = 「组合
// prompt 长什么样、呈现层认不认得出」，不是「某个函数怎么拼字符串」。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 组合串形漂移：任务文本与指令的合成不是「任务在前 + \n\n + 指令殿后」
//      的确定形状（写侧/过滤侧各拼各的 → 呈现层认不出，合成行冒名用户气泡）
//   2. 超长反馈无界：>4000 字符反馈原样内嵌（组合 prompt 被 paste 爆炸）
//   3. 截断破形：截断撕坏 HEAD/TAIL 或把代理字符对半切（wrappedBy 失配 →
//      截断行退场失败）
//   4. 组合行冒名用户：classifyUserText 对「任务前缀 + 合成余段」判 user
//      （任务+反馈双渲染，#612 套娃复辟）
//   5. 误杀真用户行：任务前缀 + 用户自己话语被判 synthetic（真话消失）

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

describe('buildRestartPrompt 截断（失败方式 2/3）', () => {
  test('短反馈基形不变（HEAD + 原文 + TAIL，既有契约零回归）', () => {
    const prompt = buildRestartPrompt('把测试也补上');
    expect(prompt).toContain('把测试也补上');
    expect(prompt.startsWith('上一轮执行失败。用户反馈：「')).toBe(true);
    expect(
      prompt.endsWith(
        '」。请把反馈纳入本轮：涉及方案先输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），再忠实执行完成任务。',
      ),
    ).toBe(true);
  });

  test('超长反馈截到上界：内嵌副本 ≤ 4000 + 截断标记，HEAD/TAIL 保形', () => {
    const feedback = '返'.repeat(RESTART_FEEDBACK_MAX_CHARS + 500);
    const prompt = buildRestartPrompt(feedback);
    expect(prompt.startsWith('上一轮执行失败。用户反馈：「')).toBe(true);
    expect(
      prompt.endsWith(
        '」。请把反馈纳入本轮：涉及方案先输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），再忠实执行完成任务。',
      ),
    ).toBe(true);
    expect(prompt).toContain('反馈过长，已截断');
    // 内嵌副本有界：HEAD 之后紧跟的前 RESTART_FEEDBACK_MAX_CHARS 字符即原反馈前缀
    const embedded = prompt.slice('上一轮执行失败。用户反馈：「'.length);
    expect(embedded.startsWith('返'.repeat(RESTART_FEEDBACK_MAX_CHARS))).toBe(true);
    expect(embedded.length).toBeLessThan(feedback.length);
  });

  test('截断不从中间撕开代理字符对（emoji 落界处回退一单位）', () => {
    // 3999 个 ASCII 后紧跟一个 2 单位 emoji：朴素 slice(0, 4000) 会留下高代理
    const feedback = `${'a'.repeat(3999)}😀${'b'.repeat(10)}`;
    const prompt = buildRestartPrompt(feedback);
    expect(prompt).not.toContain('😀');
    expect(prompt).toContain('a'.repeat(3999));
  });
});

describe('composeTaskPromptWithInstruction（失败方式 1）', () => {
  test('任务文本在前、指令殿后，空行分隔（裁决形状单源）', () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, instruction);
    expect(composed).toBe(`${TASK_TEXT}\n\n${instruction}`);
    expect(composed.startsWith(TASK_TEXT)).toBe(true);
    expect(composed.endsWith(instruction)).toBe(true);
  });
});

describe('classifyUserText 组合行识别（失败方式 4/5）', () => {
  const task = { title: TITLE, spec: SPEC };

  test('裸任务文本 → task-prompt（既有契约回归钉）', () => {
    expect(classifyUserText(TASK_TEXT.trim(), task)).toBe('task-prompt');
  });

  test('裸重启指令 → synthetic（既有契约回归钉）', () => {
    expect(classifyUserText(buildRestartPrompt('x'), task)).toBe('synthetic');
  });

  test('组合行（任务前缀 + 重启指令余段）→ synthetic 整行退场', () => {
    const composed = composeTaskPromptWithInstruction(
      TASK_TEXT,
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('组合行（截断后的重启指令余段）→ synthetic（截断不破识别）', () => {
    const instruction = buildRestartPrompt('返'.repeat(RESTART_FEEDBACK_MAX_CHARS + 100));
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, instruction);
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('组合行（任务前缀 + CONTINUE 指令余段）→ synthetic（通用合成面）', () => {
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, CONTINUE_PROMPTS.plan);
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('任务前缀 + 用户自己话语 → user（不误杀真话）', () => {
    const text = `${TASK_TEXT}\n\n另外移动端也要看一眼`;
    expect(classifyUserText(text.trim(), task)).toBe('user');
  });

  test('反馈原文 → user（真实用户行不受组合识别影响）', () => {
    expect(classifyUserText('把测试也补上', task)).toBe('user');
  });

  // #1279：组合行按落库时的任务文本拼成。标题或 spec 随后改过，当前
  // buildTaskPromptText 不再是该行前缀，前缀分支失配。裸重启行仍被词表
  // 认成 synthetic，这条组合行却落到 user，详情页把它渲染成用户气泡。
  test('组合行（任务标题已漂移）→ synthetic', () => {
    const composed = composeTaskPromptWithInstruction(
      buildTaskPromptText('漂移前标题', SPEC),
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('组合行（spec 已漂移）→ synthetic', () => {
    const composed = composeTaskPromptWithInstruction(
      buildTaskPromptText(TITLE, '旧版目标，句号收尾。'),
      buildRestartPrompt('把测试也补上'),
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('漂移组合行尾部的工作分支注记 / plan 交接注记仍 synthetic', () => {
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

  test('漂移后的裸任务文本（无重启指令）仍是 user', () => {
    const stale = buildTaskPromptText('漂移前标题', SPEC).trim();
    expect(classifyUserText(stale, task)).toBe('user');
  });

  test('用户话语含重启头但不成模板 → user', () => {
    const text = '看这段\n\n上一轮执行失败。用户反馈：「还没写完';
    expect(classifyUserText(text, task)).toBe('user');
  });
});
