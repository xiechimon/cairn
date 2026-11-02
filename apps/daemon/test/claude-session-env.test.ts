import type { ProviderConfig, SessionOpts } from '@cairn/shared';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildClaudeSdkOptions, claudeSessionEnv } from '../src/backend/claude-code.js';

const provider: ProviderConfig = { kind: 'api_key', providerId: 'anthropic' };

afterEach(() => vi.unstubAllEnvs());

function sessionOpts(patch: Partial<SessionOpts> = {}): SessionOpts {
  return { provider, modelId: 'sonnet', cwd: '/tmp/ws', ...patch };
}

describe('claudeSessionEnv', () => {
  test('passes the session env through untouched when telemetry is absent', () => {
    expect(claudeSessionEnv(sessionOpts())).toBeUndefined();
    expect(claudeSessionEnv(sessionOpts({ env: { FOO: '1' } }))).toEqual({ FOO: '1' });
  });

  test('keeps trace correlation without enabling direct CLI export', () => {
    const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/otel' })!;
    const telemetry = stepOtelContext('build-abc', 'step-xyz', target);
    const env = claudeSessionEnv(sessionOpts({ env: { FOO: '1' }, telemetry }));
    expect(env?.FOO).toBe('1');
    expect(env?.TRACEPARENT).toBe('00-c8e7752b66c5938fc686748fdc429fb0-68de601387c7a961-01');
    expect(env?.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('0');
    expect(env?.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe('0');
    expect(env?.OTEL_SDK_DISABLED).toBe('true');
    expect(env?.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env?.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
  });

  test('telemetry alone is enough to produce an env', () => {
    const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/otel' })!;
    const telemetry = stepOtelContext('b', 's', target);
    const env = claudeSessionEnv(sessionOpts({ telemetry }));
    expect(env?.TRACEPARENT).toContain('-01');
  });
});

test.each([undefined, {}])(
  'the SDK spawn boundary filters ambient telemetry with env=%s',
  (env) => {
    const inherited = {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://example.invalid/otel',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://example.invalid/traces',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=synthetic-exporter-key',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'console',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_SDK_DISABLED: 'false',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      CAIRN_OTEL_ENDPOINT: 'http://example.invalid/otel',
      CAIRN_OTEL_HEADERS: 'authorization=synthetic-exporter-key',
    };
    for (const [key, value] of Object.entries(inherited)) vi.stubEnv(key, value);
    const options = buildClaudeSdkOptions({
      cwd: '/tmp/ws',
      modelId: 'sonnet',
      resumeId: null,
      sessionId: 'telemetry-test',
      disallowedTools: [],
      mcpServers: {},
      inOrb: true,
      lockedDown: false,
      abortController: new AbortController(),
      ...(env !== undefined ? { env } : {}),
    });
    expect(options.env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
      OTEL_SDK_DISABLED: 'true',
    });
    expect(Object.keys(options.env ?? {}).filter((key) => key.startsWith('OTEL_'))).toEqual([
      'OTEL_SDK_DISABLED',
    ]);
    expect(options.env?.CAIRN_OTEL_ENDPOINT).toBeUndefined();
    expect(options.env?.CAIRN_OTEL_HEADERS).toBeUndefined();
    expect(options.settings).toMatchObject({
      env: {
        CLAUDE_CODE_ENABLE_TELEMETRY: '0',
        OTEL_SDK_DISABLED: 'true',
      },
    });
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(inherited.OTEL_EXPORTER_OTLP_ENDPOINT);
  },
);

test('subscription authentication reaches the CLI through env with subprocess scrubbing', () => {
  const token = `sk-ant-oat01-${'s'.repeat(64)}`;
  const env = { CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' };
  const options = buildClaudeSdkOptions({
    cwd: '/tmp/ws',
    modelId: 'sonnet',
    resumeId: null,
    sessionId: 'env-test',
    disallowedTools: [],
    mcpServers: {},
    inOrb: true,
    lockedDown: false,
    abortController: new AbortController(),
    env,
  });
  expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
  expect(options.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
  expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBeUndefined();
  expect(options.spawnClaudeCodeProcess).toBeUndefined();
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
  expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).not.toBe(token);
});

test('a team subscription token blanks inherited metered Claude auth so the CLI cannot fall back to paid use', () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-inherited');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'inherited-bearer');
  vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1');
  vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '1');
  vi.stubEnv('CLAUDE_CODE_USE_FOUNDRY', '1');
  const token = `sk-ant-oat01-${'t'.repeat(64)}`;
  const base = {
    cwd: '/tmp/ws',
    modelId: 'sonnet',
    resumeId: null,
    sessionId: 'metered-env-test',
    disallowedTools: [],
    mcpServers: {},
    inOrb: true,
    lockedDown: false,
    abortController: new AbortController(),
  };
  const team = buildClaudeSdkOptions({
    ...base,
    env: { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: 'sk-ant-api03-step' },
  });
  expect(team.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    expect(team.env?.[key]).toBe('');
  }
  const local = buildClaudeSdkOptions({ ...base, env: { FOO: '1' } });
  expect(local.env?.ANTHROPIC_API_KEY).toBe('sk-ant-api03-inherited');
  expect(local.env?.CLAUDE_CODE_USE_BEDROCK).toBe('1');
});
