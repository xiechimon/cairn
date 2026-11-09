import { describe, expect, test } from 'vitest';
import {
  type OtlpTarget,
  OtlpTargetConfigError,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfStep,
  otlpTraceIdOfTurn,
  parseOtlpTarget,
  stepOtelContext,
  traceparentFor,
} from '../src/otel.js';

describe('deterministic trace and span ids (same derivation as trajectory packs)', () => {
  test('pins the derivation rule with fixed vectors', () => {
    expect(otlpTraceIdOfBuild('build-abc')).toBe('c8e7752b66c5938fc686748fdc429fb0');
    expect(otlpRootSpanIdOfBuild('build-abc')).toBe('b4f97d2fe938c9a2');
    expect(otlpStepSpanIdOfBuild('build-abc', 'step-xyz')).toBe('68de601387c7a961');
  });

  test('ids are stable across calls and distinct per input', () => {
    expect(otlpTraceIdOfBuild('b1')).toBe(otlpTraceIdOfBuild('b1'));
    expect(otlpTraceIdOfBuild('b1')).not.toBe(otlpTraceIdOfBuild('b2'));
    expect(otlpStepSpanIdOfBuild('b1', 's1')).not.toBe(otlpStepSpanIdOfBuild('b1', 's2'));
    expect(otlpStepSpanIdOfBuild('b1', 's1')).not.toBe(otlpRootSpanIdOfBuild('b1'));
  });

  test('traceparent carries trace id, step span id and sampled flag', () => {
    expect(traceparentFor('c8e7752b66c5938fc686748fdc429fb0', '68de601387c7a961')).toBe(
      '00-c8e7752b66c5938fc686748fdc429fb0-68de601387c7a961-01',
    );
  });
});

describe('parseOtlpTarget', () => {
  test('returns null when the endpoint is not configured', () => {
    expect(parseOtlpTarget({})).toBeNull();
    expect(parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: '' })).toBeNull();
  });

  test('appends /v1/traces to a bare endpoint', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel',
    });
    expect(target?.url.pathname).toBe('/api/public/otel/v1/traces');
    expect(target?.headers).toEqual({});
  });

  test('keeps an endpoint that already ends with /v1/traces', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel/v1/traces',
    });
    expect(target?.url.pathname).toBe('/api/public/otel/v1/traces');
  });

  test('turns embedded credentials into a Basic authorization header', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
    });
    expect(target?.url.username).toBe('');
    expect(target?.url.password).toBe('');
    expect(target?.headers.authorization).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
  });

  test('parses CAIRN_OTEL_HEADERS pairs', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel',
      CAIRN_OTEL_HEADERS: 'X-One=1,x-two=2',
    });
    expect(target?.headers).toEqual({ 'x-one': '1', 'x-two': '2' });
  });

  test.each([
    [{ CAIRN_OTEL_ENDPOINT: '::not-a-url' }, 'CAIRN_OTEL_ENDPOINT is not a valid URL'],
    [{ CAIRN_OTEL_ENDPOINT: 'ftp://x' }, 'CAIRN_OTEL_ENDPOINT must be http or https'],
    [
      { CAIRN_OTEL_ENDPOINT: 'http://x', CAIRN_OTEL_HEADERS: 'nonsense' },
      'CAIRN_OTEL_HEADERS must look like name=value,name=value',
    ],
  ])('rejects malformed config %o', (env, message) => {
    expect(() => parseOtlpTarget(env)).toThrowError(OtlpTargetConfigError);
    expect(() => parseOtlpTarget(env)).toThrowError(message);
  });
});

describe('stepOtelContext', () => {
  test('derives ids and exposes only the configured traces target', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
      CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
    });
    const ctx = stepOtelContext('build-abc', 'step-xyz', target as OtlpTarget);
    expect(ctx.traceId).toBe('c8e7752b66c5938fc686748fdc429fb0');
    expect(ctx.stepSpanId).toBe('68de601387c7a961');
    expect(ctx.tracesUrl).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
    expect(ctx.headers['x-langfuse-ingestion-version']).toBe('4');
    expect(ctx.headers.authorization).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
  });
});

describe('turn trace ids', () => {
  test('chief steps trace per turn, other steps per build', () => {
    expect(otlpTraceIdOfStep({ kind: 'chief', buildId: 'chief-t', stepId: 's1' })).toBe(
      otlpTraceIdOfTurn('s1'),
    );
    expect(otlpTraceIdOfStep({ kind: 'build', buildId: 'b1', stepId: 's1' })).toBe(
      otlpTraceIdOfBuild('b1'),
    );
    expect(otlpTraceIdOfTurn('s1')).not.toBe(otlpTraceIdOfTurn('s2'));
  });
});
