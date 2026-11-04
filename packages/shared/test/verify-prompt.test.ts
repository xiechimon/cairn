import { describe, expect, test } from 'vitest';
import {
  buildVerifyStepPrompt,
  parseVerifyPromptMeta,
  reconcileVerifyVerdict,
  verifyVerdictSchema,
} from '../src/records/verify.js';

const TASK = '#1250 实现 verify 步\n\n范围与界限……';
const PLAN = '# plan\n\n## Verification\n- e2e 全绿\n';

describe('buildVerifyStepPrompt material (#1250)', () => {
  test('failure mode 1: evidence-dir ticket-number segment + task text + full plan text all in the material', () => {
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

  test('failure mode 2: output contract (final-segment JSON, passed truthful) in the material', () => {
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

  test('failure mode 3: workspace discipline (code read-only, only the evidence directory writable) is in the materials', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1250',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(prompt).toContain('the code is read-only');
    expect(prompt).toContain('git add / commit / push');
    expect(prompt).toContain('docs/verify/1250/');
    expect(prompt).not.toContain('writable work area');
    expect(prompt).not.toContain('## 方案');
  });

  test('#1404 S5a: the expectedHeadSha written at dispatch lands in the meta; without it no meta head is written', () => {
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

  test('failure mode 5: whether a PR exists -- with a PR, named and replied; without, truthfully states the skip', () => {
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

describe('verifyVerdictSchema shape (#1250)', () => {
  test('failure mode 5: evidence defaults to empty array; note optional; out-of-vocabulary fields stripped', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'e2e 全绿',
      evidence: [{ path: 'docs/verify/1250/e2e.json' }],
    });
    expect(parsed.evidence).toEqual([{ path: 'docs/verify/1250/e2e.json' }]);
    expect(verifyVerdictSchema.parse({ passed: false, conclusion: '挂了' }).evidence).toEqual([]);
    const stripped = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      extra: 1,
    }) as Record<string, unknown>;
    expect(stripped.extra).toBeUndefined();
  });

  test('passed/conclusion required; path required non-empty', () => {
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

describe('Verification checklist item-by-item judgment (#1492)', () => {
  const ITEMS = ['`pnpm lint` 通过', 'apps/server/test/x.test.ts 全绿'];

  test('failure mode 6: checklist numbering into the material, requiring evidence to carry the item number', () => {
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

  test('failure mode 9: without a checklist, no checklist section emitted', () => {
    const prompt = buildVerifyStepPrompt({
      ticketRef: '1',
      taskText: TASK,
      planText: '',
      pr: null,
    });
    expect(prompt).not.toContain('## 验证清单');
  });

  test('failure mode 7: evidence item field optional, old verdicts still parse', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      evidence: [{ path: 'docs/verify/1/a.json', item: 1 }, { path: 'docs/verify/1/b.json' }],
    });
    expect(parsed.evidence[0]?.item).toBe(1);
    expect(parsed.evidence[1]?.item).toBeUndefined();
  });

  test('failure mode 8: checklist item without evidence -> passed set false and named', () => {
    const r = reconcileVerifyVerdict(
      { passed: true, conclusion: '都过了', evidence: [{ path: 'docs/verify/1/a.json', item: 1 }] },
      ITEMS,
    );
    expect(r.passed).toBe(false);
    expect(r.conclusion).toContain('清单第 2 项无证据');
    expect(r.conclusion).toContain('都过了');
  });

  test('every checklist item has evidence -> verdict untouched', () => {
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

  test('version wall: evidence carries no item numbers (old daemon) -> not judged failed, conclusion states no item-by-item reconciliation was done', () => {
    const r = reconcileVerifyVerdict(
      { passed: true, conclusion: 'ok', evidence: [{ path: 'docs/verify/1/a.json' }] },
      ITEMS,
    );
    expect(r.passed).toBe(true);
    expect(r.conclusion).toContain('未逐项对账');
  });

  test('item written as the string "2" is also accepted', () => {
    const parsed = verifyVerdictSchema.parse({
      passed: true,
      conclusion: 'ok',
      evidence: [{ path: 'a', item: '2' }],
    });
    expect(parsed.evidence[0]?.item).toBe(2);
  });

  test('failure mode 9: no checklist -> verdict untouched', () => {
    const v = { passed: true, conclusion: 'ok', evidence: [] };
    expect(reconcileVerifyVerdict(v, [])).toEqual(v);
  });
});

test('motion changes require a recording path in the verification evidence (#1783)', () => {
  const prompt = buildVerifyStepPrompt({
    ticketRef: '1783',
    taskText: 'Verify',
    planText: '',
    pr: null,
    changes: [
      {
        path: 'apps/web/src/card.tsx',
        additions: 1,
        deletions: 0,
        hunks: [{ header: '@@', lines: ['+onDragStart={drag}'] }],
      },
    ],
  });
  expect(prompt).toContain('recording');
  expect(prompt).toContain('--video');
  expect(prompt).toContain('5 MiB');
});

test('verification dispatch without a supplied diff instructs the verifier to inspect recording triggers (#1783)', () => {
  const prompt = buildVerifyStepPrompt({
    ticketRef: '1783',
    taskText: 'Verify',
    planText: '',
    pr: null,
  });
  expect(prompt).toContain('Inspect the added lines');
  expect(prompt).toContain('apps/web/src/styles/motion.css');
  expect(prompt).toContain('onDrag');
  expect(prompt).toContain('recording');
});

test('a change whose hunks add no motion line does not demand a recording (#1783)', () => {
  const prompt = buildVerifyStepPrompt({
    ticketRef: '1783',
    taskText: 'Verify',
    planText: '',
    pr: null,
    changes: [
      {
        path: 'apps/web/src/card.tsx',
        additions: 1,
        deletions: 0,
        hunks: [{ header: '@@', lines: ['+  <p>New copy</p>'] }],
      },
    ],
  });
  expect(prompt).not.toContain('Animated or interactive UI changed');
});

test('a change to the motion token file alone demands a recording (#1783)', () => {
  const prompt = buildVerifyStepPrompt({
    ticketRef: '1783',
    taskText: 'Verify',
    planText: '',
    pr: null,
    changes: [
      {
        path: 'apps/web/src/styles/motion.css',
        additions: 1,
        deletions: 0,
        hunks: [{ header: '@@', lines: ['+  --motion-dur: 200ms;'] }],
      },
    ],
  });
  expect(prompt).toContain('Animated or interactive UI changed');
  expect(prompt).toContain('docs/verify/1783/');
});
