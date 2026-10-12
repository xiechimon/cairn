// 失败分类器（#1257 + #1261 两套同源测试共存）：daemon 与 server 双端消费的
// 单一事实源——#1257 classifyStepFailure（daemon 侧 network 桶决定会话续跑
// 重试，server 侧 quota 桶决定「等额度」挂起）与 #1261 classifyAgentFailure
// （daemon 检测面 + parseRetryAfterMs）。规则序与词表对齐 Multica
// taskfailure/classify.go（quota 先于 network：额度致死的流断文案归 quota
// 不归 network）。
// 失败方式先于实现固化（AGENTS.md 测试规则 3）：
//   1. quota：402（数字边界）、usage-limit 403、insufficient balance、
//      monthly usage limit、you've hit your limit（直撇/弯撇）、quota、credits
//   2. capacity：429/529（数字边界）、rate limit、overloaded、
//      concurrent request limit（语义先于 403/token 词面）
//   3. network：stream disconnected / connection reset|closed|refused /
//      mid-response / error sending request / dial tcp / dns / i/o timeout /
//      deadline exceeded / request timed out.
//   4. other：401 unauthorized、model not found、上下文超长（token limit 归
//      上下文不归 quota）、provider 5xx、空串
//   5. 桶序：quota > capacity > network（同串多语义时按 Multica 序收口）
//   6. 数字边界：402913 / 15290ms / exit status 4030 不误触桶
//   7.（#1261）classifyAgentFailure 四桶：quota/capacity 与 #1257 同义，
//      provider_network = #1257 network；F5 Retry-After 解析（秒数/冒号/
//      日期形态降级 null）；F6 脏输入（空串/大小写/JSON 内嵌）不抛不误报。

import { describe, expect, test } from 'vitest';
import {
  AGENT_FAILURE_KINDS,
  classifyAgentFailure,
  classifyStepFailure,
  parseRetryAfterMs,
  STEP_FAILURE_KINDS,
} from '../src/task-failure.js';

describe('classifyStepFailure（#1257 三桶分类）', () => {
  test('失败方式 1：quota 桶', () => {
    expect(classifyStepFailure('402 Payment Required')).toBe('quota');
    expect(classifyStepFailure('HTTP 402: insufficient credits')).toBe('quota');
    expect(classifyStepFailure('403 usage limit reached')).toBe('quota');
    expect(classifyStepFailure('insufficient_balance')).toBe('quota');
    expect(classifyStepFailure('Your balance is too low')).toBe('quota');
    expect(classifyStepFailure('monthly usage limit exceeded')).toBe('quota');
    expect(classifyStepFailure("you've hit your limit")).toBe('quota');
    expect(classifyStepFailure('you’ve hit your limit for this month')).toBe('quota');
    expect(classifyStepFailure('quota exceeded for this account')).toBe('quota');
    expect(classifyStepFailure('credits exhausted')).toBe('quota');
  });

  test('失败方式 2：capacity 桶', () => {
    expect(classifyStepFailure('429 Too Many Requests')).toBe('capacity');
    expect(classifyStepFailure('529 overloaded')).toBe('capacity');
    expect(classifyStepFailure('rate limit exceeded')).toBe('capacity');
    expect(classifyStepFailure('The server is overloaded')).toBe('capacity');
    // 语义先于 403/token 词面（Multica concurrentRequestLimitWitness）。
    expect(
      classifyStepFailure(
        'access token expired: 403 concurrent request limit reached. Try again later',
      ),
    ).toBe('capacity');
  });

  test('失败方式 3：network 桶', () => {
    // 用户实测原串（#54 relay 断流）。
    expect(classifyStepFailure('upstream stream disconnected: connection reset by peer')).toBe(
      'network',
    );
    expect(classifyStepFailure('API Error: Connection closed mid-response.')).toBe('network');
    expect(classifyStepFailure('error sending request for url (http://127.0.0.1:9/v1)')).toBe(
      'network',
    );
    expect(classifyStepFailure('dial tcp 112.80.47.186:8783: connection refused')).toBe('network');
    expect(classifyStepFailure('dns lookup failed for api.example.com')).toBe('network');
    expect(classifyStepFailure('read: i/o timeout')).toBe('network');
    expect(classifyStepFailure('context deadline exceeded')).toBe('network');
    // pi/OpenAI SDK 裸串（Multica BHD-135）。
    expect(classifyStepFailure('Request timed out.')).toBe('network');
    expect(classifyStepFailure('connectionECONNRESET')).toBe('network');
  });

  test('失败方式 4：other 桶（auth / model / 上下文 / 5xx / 空）', () => {
    expect(classifyStepFailure('401 unauthorized')).toBe('other');
    expect(classifyStepFailure('model not found: gpt-6-astra')).toBe('other');
    // token limit 归上下文不归 quota（Multica 规则序）。
    expect(classifyStepFailure('maximum context length exceeded')).toBe('other');
    expect(classifyStepFailure('tokens per minute limit reached: token limit')).toBe('other');
    expect(classifyStepFailure('500 internal error')).toBe('other');
    expect(classifyStepFailure('bad gateway')).toBe('other');
    expect(classifyStepFailure('')).toBe('other');
    expect(classifyStepFailure('   ')).toBe('other');
  });

  test('失败方式 5：桶序 quota > capacity > network', () => {
    // 额度致死常以流断文案浮出（#1257 评论 1：含额度用完致死的流）——
    // quota 词面在串里即归 quota，不被 network 桶抢走。
    expect(
      classifyStepFailure('upstream stream disconnected: connection reset by peer (402 quota)'),
    ).toBe('quota');
    expect(classifyStepFailure('stream disconnected before rate limit window reset (429)')).toBe(
      'capacity',
    );
  });

  test('失败方式 6：数字边界（402913 / 15290ms / 4030 不误触）', () => {
    expect(classifyStepFailure('input tokens: 402913 exceeds nothing')).toBe('other');
    expect(classifyStepFailure('request failed after 15290ms')).toBe('other');
    expect(classifyStepFailure('exited with error: exit status 4030')).toBe('other');
    // 边界正例对拍：同样的数字带分隔边界时必须命中。
    expect(classifyStepFailure('HTTP error 429')).toBe('capacity');
    expect(classifyStepFailure('code=402 billing')).toBe('quota');
  });

  test('词表封闭（枚举单源）', () => {
    expect(STEP_FAILURE_KINDS).toEqual(['quota', 'capacity', 'network', 'other']);
  });
});

describe('classifyAgentFailure（#1261 四桶，F1-F4）', () => {
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

  test('词表封闭（枚举单源）', () => {
    expect(AGENT_FAILURE_KINDS).toEqual(['quota', 'capacity', 'provider_network', 'other']);
  });
});

describe('parseRetryAfterMs（#1261 F5）', () => {
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
