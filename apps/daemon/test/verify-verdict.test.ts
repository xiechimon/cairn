import { describe, expect, test } from 'vitest';
import { extractVerifyVerdict, type VerifyVerdictExtraction } from '../src/verify-verdict.js';

const userMsg = (content: string) =>
  ({ role: 'user', content }) as { role: 'user'; content: string };
const assistantMsg = (content: unknown) =>
  ({ role: 'assistant', content }) as { role: 'assistant'; content: unknown };
const toolCallMsg = (name: string) =>
  assistantMsg({ kind: 'toolcall', call: { id: `call-${name}`, name, arguments: {} } });

function expectOk(messages: Parameters<typeof extractVerifyVerdict>[0]) {
  const result = extractVerifyVerdict(messages);
  expect(result.status).toBe('ok');
  return (result as Extract<VerifyVerdictExtraction, { status: 'ok' }>).verdict;
}

function expectFailed(messages: Parameters<typeof extractVerifyVerdict>[0]) {
  const result = extractVerifyVerdict(messages);
  expect(result.status).toBe('failed');
  return (result as Extract<VerifyVerdictExtraction, { status: 'failed' }>).reason;
}

const PASS_VERDICT = JSON.stringify({
  passed: true,
  conclusion: 'e2e 全绿',
  evidence: [{ path: 'docs/verify/1250/e2e.json', note: '全链截图与 API 断言' }],
});

const FAIL_VERDICT = JSON.stringify({
  passed: false,
  conclusion: '关键路径 500',
  evidence: [{ path: 'docs/verify/1250/fail.log' }],
});

describe('verify step verdict extraction (#1250)', () => {
  test('failure mode 1: trailing ```json``` block yields the verdict; passed=false is a valid conclusion', () => {
    const passed = expectOk([
      userMsg('请验证'),
      assistantMsg(`验证完成。\n\n\`\`\`json\n${PASS_VERDICT}\n\`\`\``),
    ]);
    expect(passed.passed).toBe(true);
    expect(passed.evidence).toHaveLength(1);
    const failed = expectOk([assistantMsg(`\`\`\`json\n${FAIL_VERDICT}\n\`\`\``)]);
    expect(failed.passed).toBe(false);
  });

  test('failure mode 2: trailing pure tool-call lines are skipped (backtracking continues)', () => {
    const verdict = expectOk([
      userMsg('请验证'),
      assistantMsg(PASS_VERDICT),
      toolCallMsg('set_task_meta'),
    ]);
    expect(verdict.conclusion).toBe('e2e 全绿');
  });

  test('failure mode 3: multiple JSON → last valid verdict (final-draft semantics)', () => {
    const verdict = expectOk([assistantMsg(PASS_VERDICT), assistantMsg(FAIL_VERDICT)]);
    expect(verdict.passed).toBe(false);
    expect(verdict.conclusion).toBe('关键路径 500');
  });

  test('failure mode 4: no JSON anywhere → failed "not found"', () => {
    const reason = expectFailed([userMsg('请验证'), assistantMsg('看起来没问题。')]);
    expect(reason).toContain('未找到');
  });

  test('failure mode 5: JSON present but schema fails (missing passed) → failed with reason', () => {
    const reason = expectFailed([
      assistantMsg(JSON.stringify({ conclusion: '只有结论没有 passed' })),
    ]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('passed');
  });

  test('failure mode 6: partially bad evidence → degraded, good entries kept; all bad → failed', () => {
    const verdict = expectOk([
      assistantMsg(
        JSON.stringify({
          passed: true,
          conclusion: 'e2e 全绿',
          evidence: [{ path: 'docs/verify/1250/ok.json' }, { note: '缺 path 的坏条目' }],
        }),
      ),
    ]);
    expect(verdict.evidence).toHaveLength(1);
    expect(verdict.evidence[0]?.path).toBe('docs/verify/1250/ok.json');
    expect(verdict.conclusion).toContain('1 条 evidence 因格式问题被丢弃');
    const reason = expectFailed([
      assistantMsg(
        JSON.stringify({
          passed: true,
          conclusion: 'x',
          evidence: [{ note: '缺 path' }, { note: '也缺' }],
        }),
      ),
    ]);
    expect(reason).toBeTruthy();
  });
});
