// agent 失败分类器（#1261）：quota/capacity/provider_network/other 四桶
// （Multica server/pkg/taskfailure/classify.go 同形——quota（402/usage-limit）
// 与 capacity（429/529）明确不可重试，唯一可重试的 agent 侧原因是
// provider_network）。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   F1 误报面：普通 400 协议错 / 工具失败文案不得分类成 quota 或 capacity
//      （误报 = 熔断不该停的步、板面假「等额度」）。
//   F2 桶优先级：quota 判定先于 capacity（402 语义比 429 更绑定）；带状态码
//      的诊断行（#882 provider response 形态 `-> 402`）按真状态码分桶。
//   F3 双语面：relay 常见中英文额度/限流文案都命中（new-api/one-api 族
//      relay 实测中文消息在位）。
//   F4 网络桶：连接重置 / 上游流断（#1257 家族）分类 provider_network，
//      不与 quota 混桶（后续挂起语义分道）。
//   F5 Retry-After 解析：秒数 / 冒号形态 / 日期形态（HTTP 日期不解析 =
//      null 降级，不造数值）。
//   F6 脏输入：空串 / 大小写 / 状态码内嵌 JSON body 都不抛、不误报。

import { describe, expect, test } from 'vitest';
import { classifyAgentFailure, parseRetryAfterMs } from '../src/task-failure.js';

describe('classifyAgentFailure（四桶，F1-F4）', () => {
  test('quota：402（含 #882 诊断行形态）', () => {
    expect(classifyAgentFailure('402: {"message":"Payment required"}')).toBe('quota');
    expect(
      classifyAgentFailure(
        'provider error\nprovider response: POST http://relay/v1/messages -> 402 application/json (not an SSE stream); first bytes: "insufficient credit"',
      ),
    ).toBe('quota');
  });

  test('quota：usage limit / 余额 / 欠费文案（中英）', () => {
    expect(classifyAgentFailure('usage limit reached, please wait until 7pm UTC')).toBe('quota');
    expect(classifyAgentFailure('403: {"type":"usage_limit_reached"}')).toBe('quota');
    expect(classifyAgentFailure('额度不足，请充值后重试')).toBe('quota');
    expect(classifyAgentFailure('当前分组额度已用尽 (quota exceeded)')).toBe('quota');
    expect(classifyAgentFailure('account balance is insufficient')).toBe('quota');
  });

  test('capacity：429/529/限流文案', () => {
    expect(classifyAgentFailure('429: Too Many Requests')).toBe('capacity');
    expect(classifyAgentFailure('529: overloaded')).toBe('capacity');
    expect(classifyAgentFailure('rate limit exceeded for this key')).toBe('capacity');
    expect(classifyAgentFailure('当前分组上游负载已饱和，请稍后再试')).toBe('capacity');
  });

  test('provider_network：连接重置 / 上游流断（#1257 家族）', () => {
    expect(classifyAgentFailure('upstream stream disconnected: connection reset by peer')).toBe(
      'provider_network',
    );
    expect(classifyAgentFailure('fetch failed: ECONNREFUSED 127.0.0.1:9999')).toBe(
      'provider_network',
    );
  });

  test('other：协议错 / 工具失败 / 空串不误报（F1/F6）', () => {
    expect(classifyAgentFailure('400: {"message":"Model does not support this protocol."}')).toBe(
      'other',
    );
    expect(classifyAgentFailure('git commit failed (1): lint/style/useTemplate')).toBe('other');
    expect(classifyAgentFailure('')).toBe('other');
    expect(classifyAgentFailure('session abc not found')).toBe('other');
  });

  test('优先级：quota 先于 capacity（同文并见 402+429 时）', () => {
    expect(classifyAgentFailure('429 then 402: out of credit')).toBe('quota');
  });
});

describe('parseRetryAfterMs（F5）', () => {
  test('裸秒数 / 冒号形态 / with 单位', () => {
    expect(parseRetryAfterMs('retry-after: 120')).toBe(120_000);
    expect(parseRetryAfterMs('Retry-After: 30')).toBe(30_000);
    expect(parseRetryAfterMs('retry after 45 seconds')).toBe(45_000);
    expect(parseRetryAfterMs('retry-after=60s')).toBe(60_000);
    expect(parseRetryAfterMs('please retry-after 2 minutes')).toBe(120_000);
  });

  test('HTTP 日期 / 非法值 → null（不造数值）', () => {
    expect(parseRetryAfterMs('retry-after: Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfterMs('retry-after: soon')).toBeNull();
    expect(parseRetryAfterMs('no header here')).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
  });

  test('数值上限：过大的秒数收口（防 bogus relay 值把探测排到数年后）', () => {
    expect(parseRetryAfterMs('retry-after: 999999999')).toBeNull();
  });
});
