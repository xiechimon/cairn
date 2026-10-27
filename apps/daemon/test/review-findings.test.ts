import { hasBlockingFinding } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { extractReviewVerdict, type ReviewVerdictExtraction } from '../src/review-findings.js';

const userMsg = (content: string) =>
  ({ role: 'user', content }) as { role: 'user'; content: string };
const assistantMsg = (content: unknown) =>
  ({ role: 'assistant', content }) as { role: 'assistant'; content: unknown };
const toolCallMsg = (name: string) =>
  assistantMsg({ kind: 'toolcall', call: { id: `call-${name}`, name, arguments: {} } });

function expectOk(messages: Parameters<typeof extractReviewVerdict>[0]) {
  const result = extractReviewVerdict(messages);
  expect(result.status).toBe('ok');
  return (result as Extract<ReviewVerdictExtraction, { status: 'ok' }>).verdict;
}

function expectFailed(messages: Parameters<typeof extractReviewVerdict>[0]) {
  const result = extractReviewVerdict(messages);
  expect(result.status).toBe('failed');
  return (result as Extract<ReviewVerdictExtraction, { status: 'failed' }>).reason;
}

const BLOCKING_VERDICT = JSON.stringify({
  conclusion: '方案在边界情况有硬风险',
  findings: [
    { id: '1', severity: 'blocking', summary: '空字符串未防御' },
    { id: '2', severity: 'info', summary: '建议补单元测试' },
  ],
});

describe('AI review findings extraction (M7 #330 / #700)', () => {
  test('happy 1: trailing ```json ... ``` block → verdict parsed', () => {
    const verdict = expectOk([
      userMsg('请审核方案'),
      assistantMsg(`审核意见已分析。\n\n\`\`\`json\n${BLOCKING_VERDICT}\n\`\`\``),
    ]);
    expect(verdict.conclusion).toBe('方案在边界情况有硬风险');
    expect(verdict.findings).toHaveLength(2);
    expect(verdict.findings[0]?.severity).toBe('blocking');
  });

  test('happy 2: no fence, whole-text JSON.parse succeeds', () => {
    const verdict = expectOk([assistantMsg('{"conclusion":"方案通过","findings":[]}')]);
    expect(verdict.conclusion).toBe('方案通过');
    expect(verdict.findings).toHaveLength(0);
  });

  test('happy 3: an explanatory paragraph like "this is the conclusion" after the fence → fence wins', () => {
    const verdict = expectOk([
      assistantMsg(
        '我先解释一下整体判断：方案基本可行，但有两点 blocking。\n' +
          '下面是结构化结论：\n```json\n' +
          JSON.stringify({
            conclusion: '需修复两处',
            findings: [{ id: '1', severity: 'blocking', summary: 'X' }],
          }) +
          '\n```\n这就是我的审核意见。',
      ),
    ]);
    expect(verdict.conclusion).toBe('需修复两处');
    expect(verdict.findings[0]?.summary).toBe('X');
  });

  test('#700 failure mode 1: #519 shape — set_task_meta tool call lines after the verdict JSON → extraction as usual', () => {
    const verdict = expectOk([
      userMsg('请审核方案'),
      assistantMsg(BLOCKING_VERDICT),
      toolCallMsg('set_task_meta'),
    ]);
    expect(verdict.conclusion).toBe('方案在边界情况有硬风险');
    expect(verdict.findings[0]?.severity).toBe('blocking');
  });

  test('#700 failure mode 1 continued: an empty-text closing turn after the tool lines (pi empty turn) → still extracted as usual', () => {
    const verdict = expectOk([
      assistantMsg(BLOCKING_VERDICT),
      toolCallMsg('set_task_meta'),
      assistantMsg(''),
      assistantMsg([{ type: 'thinking', thinking: '…' }]),
    ]);
    expect(verdict?.conclusion).toBe('方案在边界情况有硬风险');
  });

  test('#700 failure mode 2: no JSON anywhere (pure prose output) → failed reports "not found"', () => {
    const reason = expectFailed([
      userMsg('请审核方案'),
      assistantMsg('看完了，方案整体可行，没有明显风险，就这样。'),
      toolCallMsg('set_task_meta'),
    ]);
    expect(reason).toContain('未找到');
    expect(reason).not.toContain('审核未返回');
  });

  test('#700 failure mode 3: multiple messages with multiple JSON → take the last valid verdict (final-draft semantics)', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"旧结论","findings":[]}'),
      userMsg('继续'),
      assistantMsg(
        '{"conclusion":"新结论","findings":[{"id":"1","severity":"blocking","summary":"x"}]}',
      ),
    ]);
    expect(verdict.conclusion).toBe('新结论');
    expect(verdict.findings[0]?.severity).toBe('blocking');
  });

  test('#700 failure mode 3 continued: trailing prose (no JSON) does not block backtracking → the earlier valid verdict is the final draft', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"终稿结论","findings":[]}'),
      assistantMsg('补充说明：以上结论维持不变。'),
    ]);
    expect(verdict.conclusion).toBe('终稿结论');
  });

  test('#700 failure mode 4: JSON present but schema fails (missing conclusion) → failed with the zod reason', () => {
    const reason = expectFailed([assistantMsg('{"findings":[]}')]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('conclusion');
  });

  test('#700 failure mode 4 continued: last JSON fails schema but an earlier valid verdict exists → take the earlier valid verdict', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"终稿结论","findings":[]}'),
      assistantMsg('{"findings":[]}'),
    ]);
    expect(verdict.conclusion).toBe('终稿结论');
  });

  test('failure mode: bad JSON in fence + whole text also bad → failed', () => {
    const reason = expectFailed([assistantMsg('```json\n{not valid}\n``` sorry')]);
    expect(reason).toContain('未找到');
  });

  test('failure mode: only user/tool lines (no assistant text) → failed', () => {
    const reason = expectFailed([userMsg('请审核'), toolCallMsg('set_task_meta')]);
    expect(reason).toContain('未找到');
  });

  test('failure mode: severity outside the schema vocabulary → failed with reason', () => {
    const reason = expectFailed([
      assistantMsg(
        '{"conclusion":"x","findings":[{"id":"1","severity":"critical","summary":"y"}]}',
      ),
    ]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('severity');
  });

  test('failure mode: empty transcript → failed', () => {
    const reason = expectFailed([]);
    expect(reason).toContain('未找到');
  });

  test('happy 4: content is a text block array (pi shape) → still parses', () => {
    const verdict = expectOk([
      assistantMsg([
        { type: 'text', text: '先解释一下' },
        {
          type: 'text',
          text: `\n\`\`\`json\n${JSON.stringify({ conclusion: '通过', findings: [] })}\n\`\`\``,
        },
      ]),
    ]);
    expect(verdict.conclusion).toBe('通过');
  });

  test('happy 5: content = {type:"text", text:"…"} object (single block) → still parses', () => {
    const verdict = expectOk([
      assistantMsg({ type: 'text', text: '{"conclusion":"OK","findings":[]}' }),
    ]);
    expect(verdict.conclusion).toBe('OK');
  });

  test('attached: `{...}` followed by prose (no fence) → first-span extraction', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"OK","findings":[]} 以上，请按此处理。'),
    ]);
    expect(verdict.conclusion).toBe('OK');
  });

  test('#808 failure mode 5: all 7 findings are line-strings (including 1 blocking) → whole order kept + blocking still decidable', () => {
    const payload = JSON.stringify({
      conclusion: '方案在边界情况有硬风险',
      findings: [
        { id: '1', severity: 'blocking', summary: '空指针未防御', file: 'src/a.ts', line: '12' },
        { id: '2', severity: 'suggestion', summary: '补日志', file: 'src/a.ts', line: '30' },
        { id: '3', severity: 'info', summary: '拼写', line: '1' },
        { id: '4', severity: 'suggestion', summary: '提取函数', file: 'src/b.ts', line: '88' },
        { id: '5', severity: 'info', summary: '注释', line: '5' },
        { id: '6', severity: 'suggestion', summary: '加测试', file: 'src/c.ts', line: '200' },
        { id: '7', severity: 'info', summary: '换行', line: '7' },
      ],
    });
    const verdict = expectOk([assistantMsg(`\`\`\`json\n${payload}\n\`\`\``)]);
    expect(verdict.findings).toHaveLength(7);
    for (const f of verdict.findings) {
      if (f.line !== undefined) expect(typeof f.line).toBe('number');
    }
    expect(verdict.findings[0]?.line).toBe(12);
    expect(hasBlockingFinding(verdict)).toBe(true);
  });

  test('#808 failure mode 6: some findings bad (severity outside vocabulary) → good entries kept + bad entries dropped + conclusion annotated', () => {
    const verdict = expectOk([
      assistantMsg(
        JSON.stringify({
          conclusion: '两处需修',
          findings: [
            { id: '1', severity: 'blocking', summary: '真风险', file: 'src/a.ts', line: 3 },
            { id: '2', severity: 'critical', summary: '词表外', file: 'src/a.ts', line: 4 },
            { id: '3', severity: 'info', summary: '小建议', line: '9' },
          ],
        }),
      ),
    ]);
    expect(verdict.findings.map((f) => f.id)).toEqual(['1', '3']);
    expect(verdict.findings[1]?.line).toBe(9);
    expect(hasBlockingFinding(verdict)).toBe(true);
    expect(verdict.conclusion).toContain('两处需修');
    expect(verdict.conclusion).toContain('1 条 finding 因格式问题被丢弃');
    expect(verdict.conclusion).toContain('id=2');
  });

  test('#808 failure mode 7: all findings bad (conclusion present but none usable) → failed, never let a behavior pass by mistake', () => {
    const reason = expectFailed([
      assistantMsg(
        JSON.stringify({
          conclusion: '方案有硬风险',
          findings: [
            { id: '1', severity: 'critical', summary: '词表外' },
            { id: '2', severity: 'blocking' },
          ],
        }),
      ),
    ]);
    expect(reason).toContain('契约校验失败');
  });

  test('#808 failure mode 8 precedence: new message degradable, old message strictly valid → take the old strictly-valid verdict (final-draft semantics unchanged)', () => {
    const verdict = expectOk([
      assistantMsg(
        '{"conclusion":"旧终稿","findings":[{"id":"1","severity":"info","summary":"x"}]}',
      ),
      assistantMsg(
        JSON.stringify({
          conclusion: '新尝试',
          findings: [
            { id: '1', severity: 'blocking', summary: '真风险' },
            { id: '2', severity: 'critical', summary: '词表外' },
          ],
        }),
      ),
    ]);
    expect(verdict.conclusion).toBe('旧终稿');
  });

  test('#808 failure mode 8 continued: new message degradable, no earlier valid verdict → degradation is promoted', () => {
    const verdict = expectOk([
      assistantMsg('纯散文，没有 JSON。'),
      assistantMsg(
        JSON.stringify({
          conclusion: '新尝试',
          findings: [
            { id: '1', severity: 'blocking', summary: '真风险' },
            { id: '2', severity: 'critical', summary: '词表外' },
          ],
        }),
      ),
    ]);
    expect(verdict.findings).toHaveLength(1);
    expect(hasBlockingFinding(verdict)).toBe(true);
    expect(verdict.conclusion).toContain('被丢弃');
  });

  test('a prompt echo containing a pass example cannot override a final block line', () => {
    const result = extractReviewVerdict([
      userMsg('Return VERDICT: pass or VERDICT: block'),
      assistantMsg('Echoed example: {"conclusion":"Example pass","findings":[]}'),
      assistantMsg('The actual review found a missing authorization check.\nVERDICT: block'),
    ]);
    expect(result.status).toBe('failed');
  });

  test('a prompt echo without a reviewer verdict fails closed', () => {
    const result = extractReviewVerdict([
      userMsg('Example: {"conclusion":"Example pass","findings":[]}'),
      assistantMsg('Review started, but no final verdict was produced.'),
    ]);
    expect(result.status).toBe('failed');
  });

  test.each([false, true])(
    'an invalid safety verdict never degrades or falls back to an older pass (%s)',
    (earlierPass) => {
      const invalid = JSON.stringify({
        conclusion: 'No-go',
        gateLoosening: true,
        evalRulerChange: false,
        findings: [
          { id: '1', severity: 'suggestion', summary: 'Valid finding' },
          { id: '2', severity: 'blocking', summary: 'Invalid line', line: 'unknown' },
        ],
      });
      const messages = earlierPass
        ? [assistantMsg('{"conclusion":"Old pass","findings":[]}'), assistantMsg(invalid)]
        : [assistantMsg(invalid)];
      expect(extractReviewVerdict(messages).status).toBe('failed');
    },
  );
});

describe('product gate final verdict', () => {
  test.each([
    [assistantMsg('{"conclusion":"Echo pass","findings":[]}'), assistantMsg('Review unfinished')],
    [assistantMsg('```json\n{"conclusion":"Echo pass","findings":[]}\n```\nReview unfinished')],
  ])('rejects an earlier assistant example without a final verdict', (...messages) => {
    expect(extractReviewVerdict(messages, { requireFinalVerdict: true }).status).toBe('failed');
  });
  test('accepts terminal JSON followed only by empty assistant tool content', () => {
    expect(
      extractReviewVerdict([assistantMsg(BLOCKING_VERDICT), toolCallMsg('done')], {
        requireFinalVerdict: true,
      }).status,
    ).toBe('ok');
  });
});
