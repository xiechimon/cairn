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
import {
  buildVerifyStepPrompt,
  parseVerifyPromptMeta,
  reconcileVerifyVerdict,
  verifyVerdictSchema,
} from '../src/records/verify.js';

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

  test('失败方式 3：工作区纪律（代码只读、仅证据目录可写）在材料里', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(prompt).toContain('代码只读');
    expect(prompt).toContain('git add / commit / push');
    expect(prompt).toContain('docs/verify/1250/');
    expect(prompt).not.toContain('可写工作区');
    expect(prompt).not.toContain('## 方案');
  });

  test('#1404 S5a：派步时写下的 expectedHeadSha 进 meta，缺省不写头', () => {
    const sha = 'ab'.repeat(20);
    const withSha = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: '',
      pr: null,
      expectedHeadSha: sha,
    });
    expect(parseVerifyPromptMeta(withSha)?.expectedHeadSha).toBe(sha);
    expect(parseVerifyPromptMeta(withSha)?.kind).toBe('verify');
    const without = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(parseVerifyPromptMeta(without)).toBeNull();
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

// #1492 verify 步按方案 Verification 清单逐项出判定。失败方式先于实现固化：
//   6. 清单没进材料 → Verifier 当场自己想验什么（票面现状）。
//   7. evidence 不对应清单项 → 人看不出哪项验了哪项没验。
//   8. 清单有项没证据却报 passed=true → 合并闸读到假通过。
//   9. 没有清单（直执行任务、老方案）→ 行为不变，不因缺清单判失败。
describe('Verification 清单逐项判定（#1492）', () => {
  const ITEMS = ['`pnpm lint` 通过', 'apps/server/test/x.test.ts 全绿'];

  test('失败方式 6：清单编号列进材料，并要求 evidence 带 item 序号', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1492',
      taskText: TASK,
      planText: PLAN,
      verificationItems: ITEMS,
      pr: null,
    });
    expect(prompt).toContain('## 验证清单');
    expect(prompt).toContain('1. `pnpm lint` 通过');
    expect(prompt).toContain('2. apps/server/test/x.test.ts 全绿');
    expect(prompt).toContain('"item"');
  });

  test('失败方式 9：无清单时不出清单段', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(prompt).not.toContain('## 验证清单');
  });

  test('失败方式 7：evidence 的 item 字段可选，老 verdict 照样解析', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      evidence: [{ path: 'docs/verify/1/a.json', item: 1 }, { path: 'docs/verify/1/b.json' }],
    });
    expect(parsed.evidence[0]?.item).toBe(1);
    expect(parsed.evidence[1]?.item).toBeUndefined();
  });

  test('失败方式 8：清单有项没证据 → passed 置 false 并点名', () => {
    const r = reconcileVerifyVerdict(
      { passed: true, conclusion: '都过了', evidence: [{ path: 'docs/verify/1/a.json', item: 1 }] },
      ITEMS,
    );
    expect(r.passed).toBe(false);
    expect(r.conclusion).toContain('清单第 2 项无证据');
    expect(r.conclusion).toContain('都过了');
  });

  test('清单每项都有证据 → verdict 原样不动', () => {
    const v = {
      passed: true,
      conclusion: 'ok',
      evidence: [
        { path: 'docs/verify/1/a.json', item: 1 },
        { path: 'docs/verify/1/b.json', item: 2 },
      ],
    };
    expect(reconcileVerifyVerdict(v, ITEMS)).toEqual(v);
  });

  test('版本墙：证据都不带序号（旧 daemon）→ 不判失败，结论写明未逐项对账', () => {
    const r = reconcileVerifyVerdict(
      { passed: true, conclusion: 'ok', evidence: [{ path: 'docs/verify/1/a.json' }] },
      ITEMS,
    );
    expect(r.passed).toBe(true);
    expect(r.conclusion).toContain('未逐项对账');
  });

  test('item 写成字符串 "2" 也认', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      evidence: [{ path: 'a', item: '2' }],
    });
    expect(parsed.evidence[0]?.item).toBe(2);
  });

  test('失败方式 9：无清单 → verdict 原样不动', () => {
    const v = { passed: true, conclusion: 'ok', evidence: [] };
    expect(reconcileVerifyVerdict(v, [])).toEqual(v);
  });
});
