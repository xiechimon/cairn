// #1025 首轮 plan 步契约指令 + #1203 plan.md 交接位置行：契约指令此前写死
// 「工作区根目录」——local-repo 项目的 conv 工作区即 repo checkout，plan.md
// 落工作区根 = 落仓库根，agent 视其为交接物而 git add（#24 / PR #1201 首版
// 实锤）。本票契约指令位置无关化（「交接位置」由 daemon 追加的指令行承载：
// 路径是执行机本地事实，server 侧模板无法预知），shared 新增位置行的
// 组装/追加/过滤三件单源。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 契约句仍指向仓库内位置（「工作区根目录」残留）——根因句不灭
//   2. 位置行形状漂移：head/tail 与过滤侧 strip 对不上 → 追加了注记的合成
//      行全部冒名用户（组合行/裸指令/续轮占位句/驳回/重启全族）
//   3. 追加不幂等：recover 面 resume prompt 已含注记 → 双注
//   4. 剥注记变成放行：余段是用户话语（非模板）仍须判 user——strip 只是让
//      模板比对能命中，不是合成判定本身
//   5. 误杀真话回归：任务前缀 + 用户自己话语（无注记）→ user（#612 原负例）
//   6. 契约/组合形状漂移：组合不等于 composeTaskPromptWithInstruction 单源
//      形状（写侧/过滤侧各拼各的 → 呈现层认不出）

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
/** 任意机器本地路径（过滤侧只认形状，不认路径值）。 */
const PLAN_FILE = '/home/u/.cairn/plans/0198f6c0-0000-7000-8000-000000000000/plan.md';
const NOTE = buildPlanLocationNote(PLAN_FILE);

describe('契约文本位置无关化（失败方式 1）', () => {
  test('首轮契约含文件名 + 四段名 + 交接位置引用；不再指向工作区根目录', () => {
    expect(CONTRACT).toContain(PLAN_FILE_NAME);
    expect(CONTRACT).toContain('交接位置');
    expect(CONTRACT).toContain('（覆盖 Context/Changes/Edge cases/Verification 四段）');
    // #1203 根因句：工作区根目录 = local-repo checkout，出现即回归
    expect(CONTRACT).not.toContain('工作区根目录');
  });

  test('补写指令同律（纠错轮模板不残留工作区根目录）', () => {
    expect(REWRITE).toContain(PLAN_FILE_NAME);
    expect(REWRITE).toContain('交接位置');
    expect(REWRITE).not.toContain('工作区根目录');
  });
});

describe('交接位置行（#1203 组装/追加单源）', () => {
  test('位置行形状：head 标记 + 路径 + 出仓约束（过滤侧 strip 的锚点）', () => {
    expect(NOTE.startsWith(`${PLAN_FILE_NAME} 交接位置：`)).toBe(true);
    expect(NOTE).toContain(PLAN_FILE);
    expect(NOTE).toContain('仓库检出之外');
    expect(NOTE).toContain('git add');
  });

  test('追加 = 单换行拼接（prompt 尾部一行）', () => {
    expect(appendPlanLocationNote(REWRITE, PLAN_FILE)).toBe(`${REWRITE}\n${NOTE}`);
  });

  test('追加幂等：注记已在场（recover 面 resume prompt）→ 原文返回不双注', () => {
    const once = appendPlanLocationNote(REWRITE, PLAN_FILE);
    expect(appendPlanLocationNote(once, PLAN_FILE)).toBe(once);
  });
});

describe('契约组合形状（失败方式 6）', () => {
  test('任务文本在前、契约殿后，空行分隔（compose 单源形状）', () => {
    const composed = composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT);
    expect(composed).toBe(`${TASK_TEXT}\n\n${CONTRACT}`);
    expect(composed.startsWith(TASK_TEXT)).toBe(true);
    expect(composed.endsWith(CONTRACT)).toBe(true);
  });
});

describe('classifyUserText 注记行识别（失败方式 2/4/5）', () => {
  const task = { title: TITLE, spec: SPEC };

  test('组合行 + 注记 → synthetic 整行退场（首轮 plan 步投递形）', () => {
    const composed = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT),
      PLAN_FILE,
    );
    expect(classifyUserText(composed.trim(), task)).toBe('synthetic');
  });

  test('裸契约指令 + 注记 → synthetic', () => {
    expect(classifyUserText(`${CONTRACT}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('补写指令 + 注记 → synthetic（续轮指令单行形）', () => {
    expect(classifyUserText(`${REWRITE}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('续轮占位句 + 注记 → synthetic（CONTINUE_PROMPTS.plan 形）', () => {
    expect(classifyUserText(`${CONTINUE_PROMPTS.plan}\n${NOTE}`.trim(), task)).toBe('synthetic');
  });

  test('驳回重规划 + 注记 → synthetic（wrappedBy 族叠注记）', () => {
    expect(classifyUserText(`${buildReplanPrompt('太重了')}\n${NOTE}`.trim(), task)).toBe(
      'synthetic',
    );
  });

  test('失败重启组合行 + 注记 → synthetic（#720 组合形叠注记）', () => {
    const composed = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt('把测试也补上')),
      PLAN_FILE,
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
