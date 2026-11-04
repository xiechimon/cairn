import { describe, expect, test, vi } from 'vitest';
import {
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpTarget,
  OtlpTargetConfigError,
  otlpAttributes,
  otlpNanos,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceparent,
  otlpTracesRequest,
  parseOtlpTarget,
  postOtlpTraces,
  stepOtelContext,
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
    expect(otlpTraceparent('c8e7752b66c5938fc686748fdc429fb0', '68de601387c7a961')).toBe(
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
  test('derives ids and exposes both raw traces URL and SDK exporter forms', () => {
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
      CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
    });
    const ctx = stepOtelContext('build-abc', 'step-xyz', target as OtlpTarget);
    expect(ctx.traceId).toBe('c8e7752b66c5938fc686748fdc429fb0');
    expect(ctx.stepSpanId).toBe('68de601387c7a961');
    expect(ctx.tracesUrl).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
    expect(ctx.exporterEndpoint).toBe('http://127.0.0.1:3000/api/public/otel');
    expect(ctx.exporterHeaders).toContain('x-langfuse-ingestion-version=4');
    expect(ctx.exporterHeaders).toContain(
      `authorization=Basic ${Buffer.from('pk:sk').toString('base64')}`,
    );
  });
});

describe('OTLP wire encoding', () => {
  test('encodes attribute value kinds', () => {
    expect(
      otlpAttributes({
        s: 'text',
        i: 42,
        d: 1.5,
        b: true,
        list: ['a', 'b'],
        money: { double: 0.25 },
      }),
    ).toEqual([
      { key: 's', value: { stringValue: 'text' } },
      { key: 'i', value: { intValue: '42' } },
      { key: 'd', value: { doubleValue: 1.5 } },
      { key: 'b', value: { boolValue: true } },
      {
        key: 'list',
        value: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } },
      },
      { key: 'money', value: { doubleValue: 0.25 } },
    ]);
  });

  test('converts epoch milliseconds to unix nanos', () => {
    expect(otlpNanos(1_700_000_000_123)).toBe('1700000000123000000');
  });

  test('builds a resourceSpans envelope', () => {
    const request = otlpTracesRequest({ 'service.name': 'cairn' }, 'cairn.daemon', [
      {
        traceId: 'c8e7752b66c5938fc686748fdc429fb0',
        spanId: '68de601387c7a961',
        name: 'step plan',
        kind: OTLP_SPAN_KIND.internal,
        startTimeUnixNano: '1',
        endTimeUnixNano: '2',
        attributes: [],
      },
    ]);
    expect(request.resourceSpans).toHaveLength(1);
    expect(request.resourceSpans[0]?.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
    ]);
    expect(request.resourceSpans[0]?.scopeSpans[0]?.scope.name).toBe('cairn.daemon');
    expect(request.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe('step plan');
    expect(OTLP_STATUS_ERROR).toBe(2);
  });
});

describe('postOtlpTraces', () => {
  test('posts JSON to the traces URL with configured headers', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
      }),
    );
    const target = parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
    });
    await postOtlpTraces(target as OtlpTarget, { resourceSpans: [] });
    expect(seen).toHaveLength(1);
    const sentHeaders = (seen[0]?.init.headers ?? {}) as Record<string, string>;
    expect(seen[0]?.url).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
    expect(sentHeaders.authorization).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
    expect(sentHeaders['content-type']).toBe('application/json');
  });

  test('throws when the endpoint replies non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:9/otel' });
    await expect(postOtlpTraces(target as OtlpTarget, { resourceSpans: [] })).rejects.toThrow(
      'HTTP 500',
    );
  });
});
