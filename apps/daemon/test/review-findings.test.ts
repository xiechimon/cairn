// AI 审核步 findings 提取（M7 #330 / #700）：daemon review-findings.ts 从
// transcript 尾向头扫出契约产物 verdict JSON——提取器的职责是把产物取出来，
// 不是猜最后一条消息。失败方式枚举先于实现固化（AGENTS.md 测试规则 3，
// #700 票面四条）：
//   1. 尾部纯工具调用消息击穿（#519 现状 bug）→ 空文本 assistant 行跳过
//      继续向前扫，verdict 照常提取；
//   2. 全程无 JSON（agent 真没按契约输出）→ failed「未找到」，不折叠成
//      「未返回」；
//   3. 前面消息里有多个 JSON → 取最后一条**含有效 verdict** 的（终稿
//      语义），坏 JSON / 尾部散文不挡回溯；
//   4. JSON 在但 schema 不过 → failed 附 zod 原因；更早的有效 verdict
//      在时以它为准（最后一条有效 verdict = 终稿）。
// 附带：`{...}` 尾随散文（此前整段 parse 必败且无跨度回退）→ 首段跨度
// 提取；pi 形态 content（text block 数组 / 单 block 对象）照常解析。
// #808（B-C13 follow-up：模型把 line 写成字符串，严格校验曾整单丢弃）：
//   5. line 全是数字字符串 → coerce 后整单保留（blocking 照常可判）；
//   6. 部分 finding 坏（词表外 severity 等）→ 好条目保留 + 坏条目丢弃 +
//      结论注记丢弃明细，不整单丢弃；
//   7. findings 全坏（结论在但无一可用）→ failed，不误放行为通过（空
//      findings 含义是「方案通过」，不可静默折）；
//   8. 顺位：严格有效（新→旧）> 降级（最新可降级者）> failed。

import { hasBlockingFinding } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { extractReviewVerdict, type ReviewVerdictExtraction } from '../src/review-findings.js';

// Helper: 用 const 字面量构造 transcript message，避免 role 被宽化成 string。
const userMsg = (content: string) =>
  ({ role: 'user', content }) as { role: 'user'; content: string };
const assistantMsg = (content: unknown) =>
  ({ role: 'assistant', content }) as { role: 'assistant'; content: unknown };
/** 纯工具调用行（runner toolcall_end 落 transcript 的形状，#519 实测：
 * verdict JSON 之后 agent 又调了 set_task_meta）。 */
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

describe('AI 审核 findings 提取（M7 #330 / #700）', () => {
  test('happy 1：末尾 ```json ... ``` 块 → 解出 verdict', () => {
    const verdict = expectOk([
      userMsg('请审核方案'),
      assistantMsg(`审核意见已分析。\n\n\`\`\`json\n${BLOCKING_VERDICT}\n\`\`\``),
    ]);
    expect(verdict.conclusion).toBe('方案在边界情况有硬风险');
    expect(verdict.findings).toHaveLength(2);
    expect(verdict.findings[0]?.severity).toBe('blocking');
  });

  test('happy 2：无 fence，整段 JSON.parse 成功', () => {
    const verdict = expectOk([assistantMsg('{"conclusion":"方案通过","findings":[]}')]);
    expect(verdict.conclusion).toBe('方案通过');
    expect(verdict.findings).toHaveLength(0);
  });

  test('happy 3：fence 后还有「这是结论」类解释段 → 优先 fence', () => {
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

  test('#700 失败方式 1：#519 形状——verdict JSON 之后跟 set_task_meta 工具调用行 → 照常提取', () => {
    // daemon transcript 落行序（runner.ts）：message_end 文本行在前，
    // toolcall_end 工具行在后——尾部工具行就是 #519 实测击穿点。
    const verdict = expectOk([
      userMsg('请审核方案'),
      assistantMsg(BLOCKING_VERDICT),
      toolCallMsg('set_task_meta'),
    ]);
    expect(verdict.conclusion).toBe('方案在边界情况有硬风险');
    expect(verdict.findings[0]?.severity).toBe('blocking');
  });

  test('#700 失败方式 1 续：工具行之后再跟空文本收尾轮（pi 空轮）→ 仍照常提取', () => {
    const verdict = expectOk([
      assistantMsg(BLOCKING_VERDICT),
      toolCallMsg('set_task_meta'),
      assistantMsg(''),
      assistantMsg([{ type: 'thinking', thinking: '…' }]),
    ]);
    expect(verdict?.conclusion).toBe('方案在边界情况有硬风险');
  });

  test('#700 失败方式 2：全程无 JSON（纯散文输出）→ failed 报「未找到」', () => {
    const reason = expectFailed([
      userMsg('请审核方案'),
      assistantMsg('看完了，方案整体可行，没有明显风险，就这样。'),
      toolCallMsg('set_task_meta'),
    ]);
    expect(reason).toContain('未找到');
    expect(reason).not.toContain('审核未返回');
  });

  test('#700 失败方式 3：多消息多 JSON → 取最后一条有效 verdict（终稿语义）', () => {
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

  test('#700 失败方式 3 续：末条散文（无 JSON）不挡回溯 → 更早的有效 verdict 是终稿', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"终稿结论","findings":[]}'),
      assistantMsg('补充说明：以上结论维持不变。'),
    ]);
    expect(verdict.conclusion).toBe('终稿结论');
  });

  test('#700 失败方式 4：JSON 在但 schema 不过（缺 conclusion）→ failed 附 zod 原因', () => {
    const reason = expectFailed([assistantMsg('{"findings":[]}')]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('conclusion');
  });

  test('#700 失败方式 4 续：末条 JSON schema 不过、更早有有效 verdict → 取更早的有效 verdict', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"终稿结论","findings":[]}'),
      assistantMsg('{"findings":[]}'),
    ]);
    expect(verdict.conclusion).toBe('终稿结论');
  });

  test('失败方式：fence 坏 JSON + 整段也坏 → failed', () => {
    const reason = expectFailed([assistantMsg('```json\n{not valid}\n``` sorry')]);
    expect(reason).toContain('未找到');
  });

  test('失败方式：仅 user/工具行（无 assistant 文本）→ failed', () => {
    const reason = expectFailed([userMsg('请审核'), toolCallMsg('set_task_meta')]);
    expect(reason).toContain('未找到');
  });

  test('失败方式：schema 词表外 severity → failed 附原因', () => {
    const reason = expectFailed([
      assistantMsg(
        '{"conclusion":"x","findings":[{"id":"1","severity":"critical","summary":"y"}]}',
      ),
    ]);
    expect(reason).toContain('契约校验失败');
    expect(reason).toContain('severity');
  });

  test('失败方式：空 transcript → failed', () => {
    const reason = expectFailed([]);
    expect(reason).toContain('未找到');
  });

  test('happy 4：content 是 text block 数组（pi 形态）→ 仍能解析', () => {
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

  test('happy 5：content = {type:"text", text:"…"} 对象（单 block）→ 仍能解析', () => {
    const verdict = expectOk([
      assistantMsg({ type: 'text', text: '{"conclusion":"OK","findings":[]}' }),
    ]);
    expect(verdict.conclusion).toBe('OK');
  });

  test('附带：`{...}` 尾随散文（无 fence）→ 首段跨度提取', () => {
    const verdict = expectOk([
      assistantMsg('{"conclusion":"OK","findings":[]} 以上，请按此处理。'),
    ]);
    expect(verdict.conclusion).toBe('OK');
  });

  test('#808 失败方式 5：7 findings 全 line-字符串（含 1 blocking）→ 整单保留 + blocking 照常可判', () => {
    // #709 实测形态：qwen3.8-max 把 7 条 findings 的 line 全写成字符串。
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
    // blocking 可判 = server 侧自动修订回路照常触发（本票核心验收）。
    expect(hasBlockingFinding(verdict)).toBe(true);
  });

  test('#808 失败方式 6：部分 finding 坏（词表外 severity）→ 好条目保留 + 坏条目丢弃 + 结论注记', () => {
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

  test('#808 失败方式 7：findings 全坏（结论在但无一可用）→ failed，不误放行为通过', () => {
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

  test('#808 失败方式 8 顺位：新消息可降级、旧消息严格有效 → 取旧的严格有效 verdict（终稿语义不变）', () => {
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
    // 新消息严格校验挂（critical 词表外）但可降级；旧消息严格有效。
    // 降级顺位低于严格有效 → 仍取旧的严格有效 verdict。
    expect(verdict.conclusion).toBe('旧终稿');
  });

  test('#808 失败方式 8 续：新消息可降级、无更早有效 verdict → 降级转正', () => {
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
});
