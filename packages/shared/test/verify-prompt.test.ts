// 验证步材料组装与 verdict 形状（#1250 / ADR 0018 层 1）：外部行为 = 「验证
// 步的 agent 拿到什么材料、收尾 verdict 是什么形状」，断言逐条对应票面
// What。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 材料带证据目录票号段（github 关联 = issue 号）、任务文本与方案全文
//      ——Verifier 不知道验什么 = 空转。
//   2. 输出契约在材料里：末段必须且仅能是 verdict JSON（passed/conclusion/
//      evidence），passed=false 是有效结论（不是提取失败）。
//   3. 工作区纪律在材料里：证据可写可提交推送，但交付物本身不改。
//   4. PR 有无分叉：有 PR = 回贴指引；无 PR（非 github 形态）= 如实说明跳过
//      回贴段，不臆造 PR。
//   5. verdict schema：evidence 缺省空数组；path 必填非空；词表外字段剥除。

import { describe, expect, test } from 'vitest';
import { buildVerifyStepPrompt, verifyVerdictSchema } from '../src/records/verify.js';

const TASK = '#1250 实现 verify 步\n\n范围与界限……';
const PLAN = '# plan\n\n## Verification\n- e2e 全绿\n';

describe('buildVerifyStepPrompt 材料（#1250）', () => {
  test('失败方式 1：证据目录票号段 + 任务文本 + 方案全文都在材料里', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: PLAN,
      pr: { number: 1300, url: 'https://example/pull/1300' },
    });
    expect(prompt).toContain('docs/verify/1250/');
    expect(prompt).toContain(TASK);
    expect(prompt).toContain(PLAN);
  });

  test('失败方式 2：输出契约（末段 JSON、passed 如实）在材料里', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: PLAN,
      pr: null,
    });
    expect(prompt).toContain('## 输出契约');
    expect(prompt).toContain('"passed"');
    expect(prompt).toContain('evidence');
    expect(prompt).toContain('passed 如实报');
  });

  test('失败方式 3：工作区纪律（证据可写、交付物不改）在材料里', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(prompt).toContain('git add / commit / push');
    expect(prompt).toContain('不改动交付物本身');
    // 无方案轮（直执行任务）：方案段缺席，不渲染空段。
    expect(prompt).not.toContain('## 方案');
  });

  test('失败方式 4：PR 有无分叉——有 PR 指名回贴，无 PR 如实说明跳过', () => {
    const withPr = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: PLAN,
      pr: { number: 1300, url: 'https://example/pull/1300' },
    });
    expect(withPr).toContain('PR #1300');
    expect(withPr).toContain('gh pr edit');
    const noPr = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: PLAN,
      pr: null,
    });
    expect(noPr).toContain('无 GitHub PR');
    expect(noPr).toContain('PR body 回贴段跳过');
  });
});

describe('verifyVerdictSchema 形状（#1250）', () => {
  test('失败方式 5：evidence 缺省空数组；note 可缺省；词表外字段剥除', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'e2e 全绿',
      evidence: [{ path: 'docs/verify/1250/e2e.json' }],
    });
    expect(parsed.evidence).toEqual([{ path: 'docs/verify/1250/e2e.json' }]);
    expect(verifyVerdictSchema.parse({ passed: false, conclusion: '挂了' }).evidence).toEqual([]);
    // 词表外字段被 zod 剥除：从宽类型面读键，断言键已不在产物上。
    const stripped = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      extra: 1,
    }) as Record<string, unknown>;
    expect(stripped.extra).toBeUndefined();
  });

  test('passed/conclusion 必填；path 必填非空', () => {
    expect(verifyVerdictSchema.safeParse({ conclusion: 'x' }).success).toBe(false);
    expect(verifyVerdictSchema.safeParse({ passed: true }).success).toBe(false);
    expect(
      verifyVerdictSchema.safeParse({ passed: true, conclusion: 'x', evidence: [{ note: 'n' }] })
        .success,
    ).toBe(false);
    expect(
      verifyVerdictSchema.safeParse({
        passed: true,
        conclusion: 'x',
        evidence: [{ path: '' }],
      }).success,
    ).toBe(false);
  });
});
