import {
  type ProviderConfig,
  parseOtlpTarget,
  type SessionOpts,
  stepOtelContext,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { claudeSessionEnv } from '../src/backend/claude-code.js';

const provider: ProviderConfig = { kind: 'api_key', providerId: 'anthropic' };

function sessionOpts(patch: Partial<SessionOpts> = {}): SessionOpts {
  return { provider, modelId: 'sonnet', cwd: '/tmp/ws', ...patch };
}

describe('claudeSessionEnv', () => {
  test('passes the session env through untouched when telemetry is absent', () => {
    expect(claudeSessionEnv(sessionOpts())).toBeUndefined();
    expect(claudeSessionEnv(sessionOpts({ env: { FOO: '1' } }))).toEqual({ FOO: '1' });
  });

  test('merges the telemetry pins on top of the session env', () => {
    const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/otel' })!;
    const telemetry = stepOtelContext('build-abc', 'step-xyz', target);
    const env = claudeSessionEnv(sessionOpts({ env: { FOO: '1' }, telemetry }));
    expect(env?.FOO).toBe('1');
    expect(env?.TRACEPARENT).toBe('00-c8e7752b66c5938fc686748fdc429fb0-68de601387c7a961-01');
    expect(env?.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(env?.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe('1');
    expect(env?.OTEL_TRACES_EXPORTER).toBe('otlp');
    expect(env?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://127.0.0.1:3000/otel');
    expect(env?.OTEL_EXPORTER_OTLP_HEADERS).toContain(
      `authorization=Basic ${Buffer.from('pk:sk').toString('base64')}`,
    );
  });

  test('telemetry alone is enough to produce an env', () => {
    const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/otel' })!;
    const telemetry = stepOtelContext('b', 's', target);
    const env = claudeSessionEnv(sessionOpts({ telemetry }));
    expect(env?.TRACEPARENT).toContain('-01');
  });
});
