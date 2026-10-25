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
const PLAN_FILE = '/home/u/.cairn/plans/x/plan.md';

describe('Verification hard requirement reaches the prompt (failure modes 1, 2)', () => {
  test('first-round contract and rewrite instruction both carry the hard-requirement sentence', () => {
    expect(buildPlanFirstRoundInstruction()).toContain(PLAN_VERIFICATION_RULE);
    expect(buildPlanRewritePrompt()).toContain(PLAN_VERIFICATION_RULE);
  });

  test('structural rewrite instruction embeds the original problem text and the hard-requirement sentence', () => {
    const p = buildPlanContractRewritePrompt('Verification 第 2 项没有可执行的检查');
    expect(p).toContain('第 2 项没有可执行的检查');
    expect(p).toContain(PLAN_VERIFICATION_RULE);
  });
});

describe('presentation-layer filtering (failure modes 3, 4)', () => {
  test('structural rewrite instruction (with handoff location line) classifies synthetic', () => {
    const delivered = appendPlanLocationNote(buildPlanContractRewritePrompt('缺节'), PLAN_FILE);
    expect(classifyUserText(delivered, TASK)).toBe('synthetic');
  });

  test('old first-round contract combined lines and old rewrite instructions still classify synthetic', () => {
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

describe('isPlanContractRewritePrompt (failure mode 5)', () => {
  test('only recognizes the structural rewrite instruction', () => {
    expect(isPlanContractRewritePrompt(buildPlanContractRewritePrompt('缺节'))).toBe(true);
    expect(isPlanContractRewritePrompt(buildPlanRewritePrompt())).toBe(false);
    expect(isPlanContractRewritePrompt(null)).toBe(false);
    expect(isPlanContractRewritePrompt('用户自己写的话')).toBe(false);
  });
});
