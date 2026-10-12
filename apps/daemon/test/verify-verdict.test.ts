// 验证步 verdict 提取（#1250 / ADR 0018 层 1）：verify-verdict.ts 从
// transcript 尾向头扫出契约产物 verdict JSON——提取器职责与 review-findings
// 同族（#700 同律：取出契约产物，不是猜最后一条消息）。失败方式枚举先于
// 实现固化（AGENTS.md 测试规则 3）：
//   1. 末尾 ```json``` 块 / 整段 JSON → 解出 verdict（passed=false 是有效
//      结论，提取面不折成 error）；
//   2. 尾部纯工具调用消息（空文本 assistant 行）→ 跳过继续向前扫；
//   3. 多条 JSON → 取最后一条含有效 verdict 的（终稿语义）；
//   4. 全程无 JSON → failed「未找到」，不折叠成「未返回」；
//   5. JSON 在但 schema 不过（缺 passed/conclusion）→ failed 附 zod 原因；
//   6. evidence 逐条降级：passed/conclusion 在、evidence 部分坏 → 好条目
//      保留 + 坏条目丢弃 + 结论注记明细（#808 同思想）；evidence 全坏 →
//      failed，不把全坏静默折成通过。

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

describe('验证步 verdict 提取（#1250）', () => {
  test('失败方式 1：末尾 ```json``` 块解出 verdict；passed=false 是有效结论', () => {
    const passed = expectOk([
      userMsg('请验证'),
      assistantMsg(`验证完成。\n\n\`\`\`json\n${PASS_VERDICT}\n\`\`\``),
    ]);
    expect(passed.passed).toBe(true);
    expect(passed.evidence).toHaveLength(1);
    const failed = expectOk([assistantMsg(`\`\`\`json\n${FAIL_VERDICT}\n\`\`\``)]);
    expect(failed.passed).toBe(false);
  });

  test('失败方式 2：尾部纯工具调用行跳过（回溯继续）', () => {
    const verdict = expectOk([
      userMsg('请验证'),
      assistantMsg(PASS_VERDICT),
      toolCallMsg('set_task_meta'),
    ]);
    expect(verdict.conclusion).toBe('e2e 全绿');
  });

  test('失败方式 3：多条 JSON → 最后一条有效 verdict（终稿语义）', () => {
    const verdict = expectOk([assistantMsg(PASS_VERDICT), assistantMsg(FAIL_VERDICT)]);
    expect(verdict.passed).toBe(false);
    expect(verdict.conclusion).toBe('关键路径 500');
  });

  test('失败方式 4：全程无 JSON → failed「未找到」', () => {
    const reason = expectFailed([userMsg('请验证'), assistantMsg('看起来没问题。')]);
    expect(reason).toContain('未找到');
  });

  test('失败方式 5：JSON 在但 schema 不过（缺 passed）→ failed 附原因', () => {
    const reason = expectFailed([
      assistantMsg(JSON.stringify({ conclusion: '只有结论没有 passed' })),
    ]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('passed');
  });

  test('失败方式 6：evidence 部分坏 → 降级保留好条目；全坏 → failed', () => {
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
    // 全坏：结论在但 evidence 无一可用 → failed（不静默折成通过）。
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
