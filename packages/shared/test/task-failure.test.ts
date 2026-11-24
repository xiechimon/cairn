import { describe, expect, test } from 'vitest';
import {
  AGENT_FAILURE_KINDS,
  CLAUDE_CODE_AUTH_FAILURE_MARKER,
  classifyAgentFailure,
  classifyRetryFailure,
  classifyStepFailure,
  isMissingCommandHookNote,
  isProviderAuthFailure,
  isProviderOutage,
  missingSetupCommand,
  noVisionSignalOf,
  parseQuotaResetAt,
  parseRetryAfterMs,
  parseRetryDelayMs,
  RETRY_FAILURE_CLASSES,
  runtimeUpdateRequired,
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

  test.each([
    'model synthetic/glm-5.3 not found',
    'unsupported_model: glm-5.3',
    'unsupported-model: glm-5.3',
    'unsupported model: glm-5.3',
    'Model "glm-5.3" is not supported',
    'model not supported: glm-5.3',
    'Model "glm-5.3" is not supported by any configured account in this group',
    '404 model_not_found (quota service status 503)',
  ])('terminal model rejection takes precedence over misleading diagnostics: %s', (error) => {
    expect(classifyStepFailure(error)).toBe('model_unavailable');
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
      'runtime_outdated',
      'network',
      'other',
    ]);
  });
});

const OUTDATED_CLI =
  'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required';

describe('runtime_outdated: the provider asks for a newer agent CLI', () => {
  test('the measured Claude Code rejection is runtime_outdated, not a retryable other', () => {
    expect(classifyStepFailure(OUTDATED_CLI)).toBe('runtime_outdated');
  });

  test('it names the runtime and both versions', () => {
    expect(runtimeUpdateRequired(OUTDATED_CLI)).toEqual({
      runtime: 'Claude Code',
      current: '2.1.278',
      required: '2.1.280',
    });
    expect(runtimeUpdateRequired('400 version 3.0.1 or newer is required')).toEqual({
      runtime: null,
      current: null,
      required: '3.0.1',
    });
    expect(runtimeUpdateRequired('400 invalid_request_error: bad tool schema')).toBeNull();
  });
});

describe('isProviderOutage (#1786 provider 5xx and account exhaustion)', () => {
  test('provider 5xx and account-exhaustion phrasing trigger fallback', () => {
    expect(isProviderOutage('503 All available accounts exhausted')).toBe(true);
    expect(isProviderOutage('upstream error: HTTP 502 Bad Gateway')).toBe(true);
    expect(isProviderOutage('provider error: HTTP 5xx')).toBe(true);
    expect(isProviderOutage('upstream responded with status 500')).toBe(true);
    expect(isProviderOutage('POST /v1/messages -> 503 application/json')).toBe(true);
    expect(isProviderOutage('502 Internal Server Error')).toBe(true);
    expect(isProviderOutage('quota exhausted on all accounts')).toBe(true);
    expect(isProviderOutage('credits exhausted')).toBe(true);
    expect(isProviderOutage('insufficient balance')).toBe(true);
  });

  test('errors outside the provider channel do not trigger fallback', () => {
    expect(isProviderOutage('')).toBe(false);
    expect(isProviderOutage('429 rate limited')).toBe(false);
    expect(isProviderOutage('Context length exceeded: 200000 tokens')).toBe(false);
    expect(
      isProviderOutage(
        'git push failed (1): remote: error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500',
      ),
    ).toBe(false);
    expect(
      isProviderOutage(
        'git push failed (signal SIGTERM): Writing objects: 55% (512/930), 12.3 MiB',
      ),
    ).toBe(false);
    expect(isProviderOutage('checked out 512 files')).toBe(false);
    expect(isProviderOutage('context window exhausted mid-run')).toBe(false);
    expect(isProviderOutage('retry budget exhausted')).toBe(false);
    expect(isProviderOutage('the agent exhausted its tool-call budget')).toBe(false);
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

describe('noVisionSignalOf (#1671 tight-capability signal)', () => {
  test.each([
    '400: {"error":{"message":"GLM-5.3-BF16-W4A8 is not a multimodal model","code":"1006"}}',
    'this model does not support image input',
    'the endpoint does not support images',
    'ACP initialize failed: gemini ACP backend: image capability is not advertised',
  ])('matches: %s', (msg) => {
    expect(noVisionSignalOf(msg)).toBe(true);
  });

  test.each([
    '',
    '不支持的图片格式',
    'image too large',
    'unsupported image format',
    'unsupported file type: image/heic',
    '402 insufficient credits',
    'model not found',
  ])('does not match (per-image errors are not capability signals): %s', (msg) => {
    expect(noVisionSignalOf(msg)).toBe(false);
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
  test('recognizes the stable marker shared by both Claude Code credential messages', () => {
    expect(isProviderAuthFailure(`${CLAUDE_CODE_AUTH_FAILURE_MARKER} credential rejected`)).toBe(
      true,
    );
  });

  test.each([
    '401 Unauthorized: missing or bad api key',
    'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    'Invalid API key provided',
    'incorrect api key',
    'invalid_api_key',
    'API key expired',
    'Failed to authenticate: OAuth token revoked',
    'Failed to authenticate',
    'OAuth token revoked',
    'authentication_failed',
  ])('matches: %s', (msg) => {
    expect(isProviderAuthFailure(msg)).toBe(true);
  });

  test.each([
    '',
    '402: quota exceeded',
    '429 rate limited',
    'request took 4013ms',
    '400: bad protocol',
    'build failed: test assertion failed',
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

describe('classifyRetryFailure & parseRetryDelayMs / parseQuotaResetAt', () => {
  test('vocabulary is closed', () => {
    expect(RETRY_FAILURE_CLASSES).toEqual(['permanent', 'transient', 'rate_limit', 'unknown']);
  });

  test('permanent errors park immediately with a specific reason code', () => {
    expect(
      classifyRetryFailure('workspace hook .agents/setup exited 1 — corepack: command not found'),
    ).toMatchObject({ failureClass: 'permanent', reasonCode: 'setup_hook' });
    expect(classifyRetryFailure('spawn pnpm ENOENT')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'missing_tool',
    });
    expect(classifyRetryFailure('401 Unauthorized: invalid api key')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'auth',
    });
    expect(classifyRetryFailure('Not logged in · Please run /login')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'auth',
    });
    expect(classifyRetryFailure('400 invalid_request_error: bad schema')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'config',
    });
    expect(classifyRetryFailure('model_not_found: glm-5.3')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'model_unavailable',
    });
    expect(classifyRetryFailure(OUTDATED_CLI)).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'runtime_outdated',
    });
    expect(classifyRetryFailure('PR Auto-fix needs you: #12 CI fix cap reached')).toMatchObject({
      failureClass: 'permanent',
      reasonCode: 'gate_rejection',
    });
  });

  test('rate_limit / quota errors extract Retry-After, HTTP-date, natural duration and reset clocks', () => {
    const now = Date.UTC(2026, 10, 24, 6, 0, 0);
    expect(classifyRetryFailure('429 Too Many Requests; Retry-After: 5400', now)).toEqual({
      failureClass: 'rate_limit',
      reasonCode: 'rate_limit',
      retryAfterMs: 5_400_000,
      resetAt: now + 5_400_000,
    });
    expect(parseRetryDelayMs('retry-after: Tue, 24 Nov 2026 07:30:00 GMT', now)).toBe(90 * 60_000);
    expect(parseRetryDelayMs('retry-after-ms: 1500', now)).toBe(1500);
    expect(parseRetryDelayMs('Rate limited, please try again in 2m 30s', now)).toBe(150_000);
    expect(parseQuotaResetAt('usage limit reached, wait until 07:30 UTC', now)).toBe(
      Date.UTC(2026, 10, 24, 7, 30, 0),
    );
    expect(
      classifyRetryFailure('402 quota exceeded; available at 2026-11-24T08:00:00Z', now),
    ).toEqual({
      failureClass: 'rate_limit',
      reasonCode: 'quota',
      retryAfterMs: 2 * 3_600_000,
      resetAt: Date.UTC(2026, 10, 24, 8, 0, 0),
    });
  });

  test('transient errors classify network, 5xx and runner disconnects', () => {
    expect(classifyRetryFailure('upstream error: HTTP 503 Service Unavailable')).toMatchObject({
      failureClass: 'transient',
      reasonCode: 'server_error',
    });
    expect(classifyRetryFailure('connection reset by peer')).toMatchObject({
      failureClass: 'transient',
      reasonCode: 'network',
    });
    expect(
      classifyRetryFailure('这一轮已经结束，但任务没有收到结果，系统把它标为失败。'),
    ).toMatchObject({
      failureClass: 'transient',
      reasonCode: 'runner_disconnect',
    });
  });

  test('unknown errors fall back cleanly without false positives', () => {
    expect(classifyRetryFailure('TypeError: unexpected widget invariant mismatch')).toMatchObject({
      failureClass: 'unknown',
      reasonCode: 'unknown',
    });
    expect(classifyRetryFailure('build failed: test assertion failed')).toMatchObject({
      failureClass: 'unknown',
      reasonCode: 'unknown',
    });
  });

  test('regex unit boundaries do not misread trailing words or milliseconds as minutes/hours', () => {
    expect(parseRetryAfterMs('Retry-After: 5\nMore info')).toBe(5_000);
    expect(parseRetryAfterMs('Retry-After: 30ms')).toBe(30);
    expect(parseRetryAfterMs('Retry-After: 10 headers')).toBe(10_000);
    expect(parseRetryDelayMs('retry in 500ms')).toBe(500);
    expect(parseRetryDelayMs('Please retry in a moment. Retry in 30s')).toBe(30_000);
  });

  test('adversarial long error strings complete without quadratic regex backtracking', () => {
    const start = Date.now();
    expect(runtimeUpdateRequired(`a${' '.repeat(50_000)}x`)).toBeNull();
    expect(classifyRetryFailure(`${'hook '.repeat(20_000)}x`).failureClass).toBe('unknown');
    expect(classifyRetryFailure(`${'enoent '.repeat(20_000)}x`).failureClass).toBe('unknown');
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('missingSetupCommand and isMissingCommandHookNote', () => {
  test.each([
    ['.../.agents/setup: line 6: pnpm: command not found', 'pnpm'],
    ['.agents/setup: 6: uv: not found', 'uv'],
    ['.agents/setup:6: command not found: cargo', 'cargo'],
    ['fish: Unknown command: mise', 'mise'],
    ['env: node: No such file or directory', 'node'],
    ["The term 'pnpm' is not recognized as the name of a cmdlet", 'pnpm'],
    ["'yarn' is not recognized as an internal or external command", 'yarn'],
    ['workspace hook .agents/setup exited 127 (missing command: bun)', 'bun'],
  ])('extracts missing command from %s -> %s', (raw, expected) => {
    expect(missingSetupCommand(raw)).toBe(expected);
  });

  test.each(['', 'build failed: test assertion failed', '.agents/setup exited 3 — boom'])(
    'returns null for non-missing-command errors: %s',
    (raw) => {
      expect(missingSetupCommand(raw)).toBeNull();
    },
  );

  test('detects missing-command hook failures by exit 127 or parsed command name', () => {
    expect(isMissingCommandHookNote({ status: 'failed', exitCode: 127, output: '' })).toBe(true);
    expect(
      isMissingCommandHookNote({
        status: 'failed',
        exitCode: 1,
        output: '.agents/setup: line 6: pnpm: command not found',
      }),
    ).toBe(true);
    expect(isMissingCommandHookNote({ status: 'failed', exitCode: 3, output: 'boom' })).toBe(false);
    expect(isMissingCommandHookNote({ status: 'timeout', exitCode: null, output: '' })).toBe(false);
  });
});
