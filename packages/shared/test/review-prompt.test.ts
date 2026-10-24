// 审核步材料组装（#511）：外部行为 = 「某个关口组装出的审核材料里有什么」，
// 不是「某个函数怎么拼字符串」——断言逐条对应票面 User Stories。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 确认关口（gate=confirm）：材料不含变更——无变更段、无文件路径、无检出
//      段（事实还不存在，只审方案）。
//   2. 审核关口（gate=review）有变更：材料同时含方案全文与变更（文件路径 +
//      逐行 diff）——审核者能做人能做的事。
//   3. 审核关口变更面为空：材料如实写「无改动」，不臆造文件（US 10）。
//   4. 审核关口的只读/验证纪律在材料里：不得写、不提交、不推送，跑过的命令与
//      输出要落进结论（US 6/7/8）。
//   5. meta 头携带 gate（相位值单源）——daemon 据此决定是否开只读检出。

import { describe, expect, test } from 'vitest';
import type { DocumentDiffFile } from '../src/records/document-diff.js';
import {
  buildReviewStepPrompt,
  parseReviewPromptMeta,
  type ReviewPromptMeta,
} from '../src/records/review.js';

const PLAN = '# plan\n\n## Changes\n- 加一个 parseInput\n';

const CHANGES: DocumentDiffFile[] = [
  {
    path: 'src/parse.ts',
    additions: 2,
    deletions: 1,
    hunks: [
      {
        header: '@@ -1,3 +1,4 @@',
        lines: [
          ' const a = 1;',
          '-const b = 2;',
          '+const b = 3;',
          '+export function parseInput() {}',
        ],
      },
    ],
  },
];

function parseMeta(prompt: string): ReviewPromptMeta {
  const meta = parseReviewPromptMeta(prompt);
  if (meta === null) throw new Error('review prompt meta header missing');
  return meta;
}

describe('buildReviewStepPrompt 关口分叉（#511）', () => {
  test('失败方式 1：确认关口材料不含变更（无变更段、无文件路径、无检出段）', () => {
    const prompt = buildReviewStepPrompt({ agentId: 'a1', gate: 'confirm', planText: PLAN });
    expect(prompt).toContain(PLAN);
    expect(prompt).not.toContain('## 本轮变更');
    expect(prompt).not.toContain('src/parse.ts');
    expect(prompt).not.toContain('## 只读检出');
    expect(parseMeta(prompt).gate).toBe('confirm');
  });

  test('失败方式 2：审核关口材料含方案 + 变更（文件路径与逐行 diff 都在）', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: CHANGES,
    });
    expect(prompt).toContain(PLAN);
    expect(prompt).toContain('src/parse.ts');
    expect(prompt).toContain('@@ -1,3 +1,4 @@');
    expect(prompt).toContain('+export function parseInput() {}');
    expect(prompt).toContain('-const b = 2;');
    expect(parseMeta(prompt).gate).toBe('review');
  });

  test('失败方式 3：审核关口变更面为空 → 材料如实交代空态，不臆造文件', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: [],
    });
    expect(prompt).toContain('## 本轮变更');
    expect(prompt).toContain('变更面为空');
    expect(prompt).toContain('无改动');
    expect(prompt).not.toContain('src/parse.ts');
    // 空变更面仍是审核关口材料（有检出可读），不是退化成方案审阅
    expect(parseMeta(prompt).gate).toBe('review');
  });

  test('失败方式 3b：空变更面 + 有检出 → 材料指向检出自行核对（不把空面说成「没改东西」）', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: [],
      checkout: true,
    });
    expect(prompt).toContain('变更面为空');
    expect(prompt).toContain('检出');
    expect(prompt).not.toContain('本轮无改动');
  });

  test('失败方式 4：审核关口 + 有检出 → 材料含只读与验证纪律（不得提交/推送 + 命令与输出入结论）', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: CHANGES,
      checkout: true,
    });
    expect(prompt).toContain('## 只读检出');
    expect(prompt).toContain('不得提交');
    expect(prompt).toContain('不得推送');
    expect(prompt).toContain('命令');
  });

  test('失败方式 6：未绑 repo（checkout 缺省）→ 不写检出段（不谎称有检出），变更段照旧', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: CHANGES,
    });
    expect(prompt).not.toContain('## 只读检出');
    expect(prompt).toContain('src/parse.ts');
  });

  test('失败方式 5：用户关注点仍在尾段（回归：focus 注入口径不变）', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: CHANGES,
      focus: '关注边界情况',
    });
    expect(prompt).toContain('## 用户关注点\n关注边界情况');
    expect(parseMeta(prompt).agentId).toBe('a1');
    expect(prompt.indexOf('## 本轮变更')).toBeLessThan(prompt.indexOf('## 用户关注点'));
  });

  test('#1404 S5a：派步时写下的 expectedHeadSha 进 meta，缺省不写', () => {
    const sha = 'ab'.repeat(20);
    const withSha = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      expectedHeadSha: sha,
    });
    expect(parseMeta(withSha).expectedHeadSha).toBe(sha);
    const without = buildReviewStepPrompt({ agentId: 'a1', gate: 'confirm', planText: PLAN });
    expect(parseMeta(without).expectedHeadSha).toBeUndefined();
  });
});
