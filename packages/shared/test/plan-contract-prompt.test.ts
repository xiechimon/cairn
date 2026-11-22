import { describe, expect, test } from 'vitest';
import {
  buildPlanContractRewritePrompt,
  buildPlanFirstRoundInstruction,
  buildPlanRewritePrompt,
  isPlanContractRewritePrompt,
  PLAN_VERIFICATION_RULE,
} from '../src/records/prompts.js';

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

describe('isPlanContractRewritePrompt (failure mode 5)', () => {
  test('only recognizes the structural rewrite instruction', () => {
    expect(isPlanContractRewritePrompt(buildPlanContractRewritePrompt('缺节'))).toBe(true);
    expect(isPlanContractRewritePrompt(buildPlanRewritePrompt())).toBe(false);
    expect(isPlanContractRewritePrompt(null)).toBe(false);
    expect(isPlanContractRewritePrompt('用户自己写的话')).toBe(false);
  });
});
