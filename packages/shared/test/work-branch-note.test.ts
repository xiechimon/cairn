// #1195 工作分支注记行：agent 在步内自建分支交付（commit/push/PR 都落在自己
// 的分支上）时，产物闸按会话分支计数判「构建零改动」——失败原因完全误导。
// 预防半 = 把「只在会话分支提交」写成随 prompt 投递的硬约束（分支名是执行机
// 本地事实，daemon 投递前单点组装，#1203 交接位置注记 / #1217 守卫注记同族）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 注记形状漂移：head/tail 与过滤侧 strip 对不上 → 追加了注记的合成行
//      冒名用户气泡 / 任务文本行双渲染
//   2. 追加不幂等：recover 面 resume prompt 已含注记 → 双注
//   3. 剥注记变成放行：余段是用户话语仍须判 user——strip 只让模板比对能命中
//   4. 任务文本 + 注记（build 步新会话投递形）须仍判 task-prompt，不然任务
//      简报成用户气泡双渲染
//   5. 误杀真话回归：任务前缀 + 用户自己话语（无注记）→ user
//   6. 契约句不含根因指令缺口：必须点名「不要创建或切换分支」与 PR head 约束
//      （事故里 agent 正是自建分支开 PR）

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
const BRANCH = 'pacman/conv-0198f6c0-0000-7000-8000-000000000000';
const NOTE = buildWorkBranchNote(BRANCH);

describe('注记组装（失败方式 6）', () => {
  test('注记形状：head 标记 + 分支名 + 硬约束 tail', () => {
    expect(NOTE.startsWith('工作分支注记：本步的工作分支是 ')).toBe(true);
    expect(NOTE).toContain(BRANCH);
    expect(NOTE).toContain('不要创建或切换');
    expect(NOTE).toContain('head 分支');
  });

  test('追加 = 单换行拼接（prompt 尾部一行）', () => {
    expect(appendWorkBranchNote(TASK_TEXT, BRANCH)).toBe(`${TASK_TEXT}\n${NOTE}`);
  });

  test('追加幂等：注记已在场（recover 面 resume prompt）→ 原文返回不双注', () => {
    const once = appendWorkBranchNote(TASK_TEXT, BRANCH);
    expect(appendWorkBranchNote(once, BRANCH)).toBe(once);
  });

  test('strip 还原：尾行注记剥除后余段原文返回；非注记收尾零触碰', () => {
    expect(stripWorkBranchNote(`${TASK_TEXT}\n${NOTE}`)).toBe(TASK_TEXT);
    expect(stripWorkBranchNote(TASK_TEXT)).toBe(TASK_TEXT);
  });
});

describe('classifyUserText 注记行识别（失败方式 1/3/4/5）', () => {
  const task = { title: TITLE, spec: SPEC };

  test('任务文本 + 注记 → task-prompt（build 步新会话投递形，不双渲染）', () => {
    const composed = appendWorkBranchNote(TASK_TEXT, BRANCH);
    expect(classifyUserText(composed.trim(), task)).toBe('task-prompt');
  });

  test('续轮占位句 + 注记 → synthetic（CONTINUE_PROMPTS.build 形）', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.build}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('失败重启组合行 + 注记 → synthetic（#720 组合形叠注记）', () => {
    const composed = appendWorkBranchNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt('别自己开分支')),
      BRANCH,
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('任务前缀 + 用户自己话语 → user（不误杀真话，无注记负例不回归）', () => {
    const text = `${TASK_TEXT}\n\n另外移动端也要看一眼`;
    expect(classifyUserText(text.trim(), task)).toBe('user');
  });

  test('注记形尾行但余段是用户话语 → user（strip 只放行模板比对，不是合成判定）', () => {
    expect(classifyUserText(`另外移动端也要看一眼\n${NOTE}`.trim(), task)).toBe('user');
  });
});
