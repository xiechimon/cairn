import { describe, expect, test } from 'vitest';
import {
  AGENT_FAILURE_KINDS,
  classifyAgentFailure,
  classifyStepFailure,
  isProviderAuthFailure,
  parseRetryAfterMs,
  STEP_FAILURE_KINDS,
} from '../src/task-failure.js';

describe('classifyStepFailure (#1257 three-bucket classification)', () => {
  test('failure mode 1: quota bucket', () => {
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

  test('failure mode 2: capacity bucket', () => {
    expect(classifyStepFailure('429 Too Many Requests')).toBe('capacity');
    expect(classifyStepFailure('529 overloaded')).toBe('capacity');
    expect(classifyStepFailure('rate limit exceeded')).toBe('capacity');
    expect(classifyStepFailure('The server is overloaded')).toBe('capacity');
    expect(
      classifyStepFailure(
        'access token expired: 403 concurrent request limit reached. Try again later',
      ),
    ).toBe('capacity');
  });

  test('failure mode 3: network bucket', () => {
    expect(classifyStepFailure('upstream stream disconnected: connection reset by peer')).toBe(
      'network',
    );
    expect(classifyStepFailure('API Error: Connection closed mid-response.')).toBe('network');
    expect(classifyStepFailure('error sending request for url (http://127.0.0.1:9/v1)')).toBe(
      'network',
    );
    expect(classifyStepFailure('dial tcp 203.0.113.7:8783: connection refused')).toBe('network');
    expect(classifyStepFailure('dns lookup failed for api.example.com')).toBe('network');
    expect(classifyStepFailure('read: i/o timeout')).toBe('network');
    expect(classifyStepFailure('context deadline exceeded')).toBe('network');
    expect(classifyStepFailure('Request timed out.')).toBe('network');
    expect(classifyStepFailure('connectionECONNRESET')).toBe('network');
  });

  test('failure mode 4: other bucket (auth / context / 5xx / empty)', () => {
    expect(classifyStepFailure('401 unauthorized')).toBe('other');
    expect(classifyStepFailure('maximum context length exceeded')).toBe('other');
    expect(classifyStepFailure('tokens per minute limit reached: token limit')).toBe('other');
    expect(classifyStepFailure('500 internal error')).toBe('other');
    expect(classifyStepFailure('bad gateway')).toBe('other');
    expect(classifyStepFailure('')).toBe('other');
    expect(classifyStepFailure('   ')).toBe('other');
  });

  test('failure mode 4a: model_unavailable bucket (/v1/messages 404 / model not found)', () => {
    expect(classifyStepFailure('404: /v1/messages not found')).toBe('model_unavailable');
    expect(
      classifyStepFailure('POST http://relay/v1/messages -> 404 model gpt-5.6-luna not found'),
    ).toBe('model_unavailable');
    expect(classifyStepFailure('model not found: gpt-6-astra')).toBe('model_unavailable');
    expect(classifyStepFailure('model_not_found: deepseek-v4.1-flash')).toBe('model_unavailable');
    expect(classifyStepFailure('model unavailable for this account')).toBe('model_unavailable');
    expect(classifyStepFailure('404: no such model')).toBe('model_unavailable');
    expect(classifyStepFailure('input tokens: 404913 exceeds nothing')).toBe('other');
  });

  test('failure mode 5: bucket order quota > capacity > network', () => {
    expect(
      classifyStepFailure('upstream stream disconnected: connection reset by peer (402 quota)'),
    ).toBe('quota');
    expect(classifyStepFailure('stream disconnected before rate limit window reset (429)')).toBe(
      'capacity',
    );
  });

  test('failure mode 6: numeric boundaries (402913 / 15290ms / 4030 no false trigger)', () => {
    expect(classifyStepFailure('input tokens: 402913 exceeds nothing')).toBe('other');
    expect(classifyStepFailure('request failed after 15290ms')).toBe('other');
    expect(classifyStepFailure('exited with error: exit status 4030')).toBe('other');
    expect(classifyStepFailure('HTTP error 429')).toBe('capacity');
    expect(classifyStepFailure('code=402 billing')).toBe('quota');
  });

  test('vocabulary closed (enum single source)', () => {
    expect(STEP_FAILURE_KINDS).toEqual([
      'quota',
      'capacity',
      'model_unavailable',
      'network',
      'other',
    ]);
  });
});

describe('classifyAgentFailure (#1261 four buckets, F1-F4)', () => {
  test('quota: 402 (including #882 diagnostic-line shape)', () => {
    expect(classifyAgentFailure('402: {"message":"Payment required"}')).toBe('quota');
    expect(
      classifyAgentFailure(
        'provider error\nprovider response: POST http://relay/v1/messages -> 402 application/json (not an SSE stream); first bytes: "insufficient credit"',
      ),
    ).toBe('quota');
  });

  test('quota: usage limit / balance / overdue-copy messages (Chinese and English)', () => {
    expect(classifyAgentFailure('usage limit reached, please wait until 7pm UTC')).toBe('quota');
    expect(classifyAgentFailure('403: {"type":"usage_limit_reached"}')).toBe('quota');
    expect(classifyAgentFailure('额度不足，请充值后重试')).toBe('quota');
    expect(classifyAgentFailure('当前分组额度已用尽 (quota exceeded)')).toBe('quota');
    expect(classifyAgentFailure('account balance is insufficient')).toBe('quota');
  });

  test('capacity: 429/529/rate-limit messages', () => {
    expect(classifyAgentFailure('429: Too Many Requests')).toBe('capacity');
    expect(classifyAgentFailure('529: overloaded')).toBe('capacity');
    expect(classifyAgentFailure('rate limit exceeded for this key')).toBe('capacity');
    expect(classifyAgentFailure('当前分组上游负载已饱和，请稍后再试')).toBe('capacity');
  });

  test('provider_network: connection reset / upstream stream break (#1257 family)', () => {
    expect(classifyAgentFailure('upstream stream disconnected: connection reset by peer')).toBe(
      'provider_network',
    );
    expect(classifyAgentFailure('fetch failed: ECONNREFUSED 127.0.0.1:9999')).toBe(
      'provider_network',
    );
  });

  test('other: protocol errors / tool failures / empty string no false positive (F1/F6)', () => {
    expect(classifyAgentFailure('400: {"message":"Model does not support this protocol."}')).toBe(
      'other',
    );
    expect(classifyAgentFailure('git commit failed (1): lint/style/useTemplate')).toBe('other');
    expect(classifyAgentFailure('')).toBe('other');
    expect(classifyAgentFailure('session abc not found')).toBe('other');
  });

  test('priority: quota before capacity (402+429 in the same text)', () => {
    expect(classifyAgentFailure('429 then 402: out of credit')).toBe('quota');
  });

  test('vocabulary closed (enum single source)', () => {
    expect(AGENT_FAILURE_KINDS).toEqual(['quota', 'capacity', 'provider_network', 'other']);
  });
});

describe('parseRetryAfterMs（#1261 F5）', () => {
  test('bare seconds / colon forms / with units', () => {
    expect(parseRetryAfterMs('retry-after: 120')).toBe(120_000);
    expect(parseRetryAfterMs('Retry-After: 30')).toBe(30_000);
    expect(parseRetryAfterMs('retry after 45 seconds')).toBe(45_000);
    expect(parseRetryAfterMs('retry-after=60s')).toBe(60_000);
    expect(parseRetryAfterMs('please retry-after 2 minutes')).toBe(120_000);
  });

  test('HTTP date / invalid value -> null (no fabricated numbers)', () => {
    expect(parseRetryAfterMs('retry-after: Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfterMs('retry-after: soon')).toBeNull();
    expect(parseRetryAfterMs('no header here')).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
  });

  test('numeric cap: excessive seconds clamped (prevents bogus relay values from scheduling probes years out)', () => {
    expect(parseRetryAfterMs('retry-after: 999999999')).toBeNull();
  });
});

describe('isProviderAuthFailure (#1493 degradation-chain trigger: auth failure)', () => {
  test.each([
    '401 Unauthorized: missing or bad api key',
    'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    'Invalid API key provided',
    'incorrect api key',
    'invalid_api_key',
    'API key expired',
  ])('matches: %s', (msg) => {
    expect(isProviderAuthFailure(msg)).toBe(true);
  });

  test.each([
    '',
    '402: quota exceeded',
    '429 rate limited',
    'request took 4013ms',
    '400: bad protocol',
    'Error: 403 usage limit reached',
    'Not logged in · Please run /login',
    "remote: Unauthorized\nfatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 401",
    '401 Unauthorized',
    'gh: Bad credentials (HTTP 401)',
    'see PR #401',
  ])('does not match: %s', (msg) => {
    expect(isProviderAuthFailure(msg)).toBe(false);
  });
});
