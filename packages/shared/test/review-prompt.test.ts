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

describe('buildReviewStepPrompt gate branching (#511)', () => {
  test('failure mode 1: confirm-gate material contains no changes (no change section, no file paths, no checkout section)', () => {
    const prompt = buildReviewStepPrompt({ agentId: 'a1', gate: 'confirm', planText: PLAN });
    expect(prompt).toContain(PLAN);
    expect(prompt).not.toContain('## 本轮变更');
    expect(prompt).not.toContain('src/parse.ts');
    expect(prompt).not.toContain('## 只读检出');
    expect(parseMeta(prompt).gate).toBe('confirm');
  });

  test('failure mode 2: review-gate material contains plan + changes (file paths and line-by-line diff both present)', () => {
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

  test('failure mode 3: review-gate empty change surface -> material states the empty state truthfully, fabricates no files', () => {
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
    expect(parseMeta(prompt).gate).toBe('review');
  });

  test('failure mode 3b: empty change surface + checkout present -> material points at the checkout for self-verification (does not call the empty surface "nothing changed")', () => {
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

  test('failure mode 4: review gate + checkout present -> material contains read-only and verification discipline (no commit/push + commands and output into the conclusion)', () => {
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

  test('failure mode 6: no bound repo (checkout default) -> no checkout section written (no false claim of a checkout), change section as usual', () => {
    const prompt = buildReviewStepPrompt({
      agentId: 'a1',
      gate: 'review',
      planText: PLAN,
      changes: CHANGES,
    });
    expect(prompt).not.toContain('## 只读检出');
    expect(prompt).toContain('src/parse.ts');
  });

  test('failure mode 5: user focus still in the final section (regression: focus injection unchanged)', () => {
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

  test('#1404 S5a: the expectedHeadSha written at dispatch lands in the meta; absent when unset', () => {
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
