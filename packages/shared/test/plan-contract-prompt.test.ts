// #1492 结构补写指令与 Verification 硬要求句：外部行为 = 「agent 被告知
// Verification 怎么写；结构补写轮的指令不冒充用户气泡；老会话里的旧契约句
// 照样被认出来」。失败方式先于实现固化：
//   1. 首轮契约与补写指令没带 Verification 硬要求 → agent 不知道规则。
//   2. 结构补写指令里点名的问题丢了 → agent 不知道改哪项。
//   3. 结构补写指令（含 daemon 追加的交接位置行）被呈现层当成用户话语。
//   4. 改了契约句之后，库里已落的旧契约句冒充用户气泡。
//   5. server 判「本轮已补写过」的判据误认普通指令。

import { describe, expect, test } from 'vitest';
import {
  appendPlanLocationNote,
  buildPlanContractRewritePrompt,
  buildPlanFirstRoundInstruction,
  buildPlanRewritePrompt,
  buildTaskPromptText,
  classifyUserText,
  composeTaskPromptWithInstruction,
  isPlanContractRewritePrompt,
  PLAN_VERIFICATION_RULE,
} from '../src/records/prompts.js';

const TASK = { title: '契约探针', spec: '写方案。' };
const PLAN_FILE = '/home/u/.pacman/plans/x/plan.md';

describe('Verification 硬要求进提示词（失败方式 1、2）', () => {
  test('首轮契约与补写指令都带硬要求句', () => {
    expect(buildPlanFirstRoundInstruction()).toContain(PLAN_VERIFICATION_RULE);
    expect(buildPlanRewritePrompt()).toContain(PLAN_VERIFICATION_RULE);
  });

  test('结构补写指令内嵌问题原文与硬要求句', () => {
    const p = buildPlanContractRewritePrompt('Verification 第 2 项没有可执行的检查');
    expect(p).toContain('第 2 项没有可执行的检查');
    expect(p).toContain(PLAN_VERIFICATION_RULE);
  });
});

describe('呈现层过滤（失败方式 3、4）', () => {
  test('结构补写指令（带交接位置行）判 synthetic', () => {
    const delivered = appendPlanLocationNote(buildPlanContractRewritePrompt('缺节'), PLAN_FILE);
    expect(classifyUserText(delivered, TASK)).toBe('synthetic');
  });

  test('旧版首轮契约组合行与旧版补写指令仍判 synthetic', () => {
    const oldContract =
      '本步的交接物是 plan.md：结束本步前，将方案写入 plan.md 交接位置指定的文件（覆盖 Context/Changes/Edge cases/Verification 四段）。';
    const oldRewrite =
      '规划步未产出 plan.md 交接文件。请将方案写入 plan.md 交接位置指定的文件（覆盖 Context/Changes/Edge cases/Verification 四段）再结束本步；若改动已在规划轮完成，plan.md 如实记录改动内容与验证方式即可。';
    const composed = composeTaskPromptWithInstruction(
      buildTaskPromptText(TASK.title, TASK.spec),
      oldContract,
    );
    expect(classifyUserText(composed, TASK)).toBe('synthetic');
    expect(classifyUserText(oldRewrite, TASK)).toBe('synthetic');
  });
});

describe('isPlanContractRewritePrompt（失败方式 5）', () => {
  test('只认结构补写指令', () => {
    expect(isPlanContractRewritePrompt(buildPlanContractRewritePrompt('缺节'))).toBe(true);
    expect(isPlanContractRewritePrompt(buildPlanRewritePrompt())).toBe(false);
    expect(isPlanContractRewritePrompt(null)).toBe(false);
    expect(isPlanContractRewritePrompt('用户自己写的话')).toBe(false);
  });
});
