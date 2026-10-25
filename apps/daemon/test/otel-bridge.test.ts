import {
  OtlpTargetConfigError,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceparent,
  parseOtlpTarget,
  stepOtelContext,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { claudeTelemetryEnv, daemonOtelFromEnv, PiStepSpanSink } from '../src/backend/otel.js';

const env = {
  CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
  CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('daemonOtelFromEnv', () => {
  test('returns null when unconfigured', () => {
    expect(daemonOtelFromEnv({})).toBeNull();
  });

  test('builds a per-step context on the server-derived trace', () => {
    const otel = daemonOtelFromEnv(env);
    expect(otel).not.toBeNull();
    const ctx = otel!.contextFor('build-abc', 'step-xyz');
    expect(ctx.traceId).toBe(otlpTraceIdOfBuild('build-abc'));
    expect(ctx.stepSpanId).toBe(otlpStepSpanIdOfBuild('build-abc', 'step-xyz'));
    expect(ctx.tracesUrl).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
  });

  test('surfaces malformed config as a config error', () => {
    expect(() => daemonOtelFromEnv({ CAIRN_OTEL_ENDPOINT: '::bad' })).toThrowError(
      OtlpTargetConfigError,
    );
  });
});

describe('claudeTelemetryEnv', () => {
  test('injects TRACEPARENT and the Claude Code telemetry pins', () => {
    const target = parseOtlpTarget(env)!;
    const ctx = stepOtelContext('build-abc', 'step-xyz', target);
    const injected = claudeTelemetryEnv(ctx);
    expect(injected.TRACEPARENT).toBe(otlpTraceparent(ctx.traceId, ctx.stepSpanId));
    expect(injected.TRACEPARENT).toBe('00-c8e7752b66c5938fc686748fdc429fb0-68de601387c7a961-01');
    expect(injected.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(injected.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe('1');
    expect(injected.OTEL_TRACES_EXPORTER).toBe('otlp');
    expect(injected.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://127.0.0.1:3000/api/public/otel');
    expect(injected.OTEL_EXPORTER_OTLP_HEADERS).toContain('x-langfuse-ingestion-version=4');
    expect(injected.OTEL_EXPORTER_OTLP_HEADERS).toContain(
      `authorization=Basic ${Buffer.from('pk:sk').toString('base64')}`,
    );
  });
});

interface CapturedRequest {
  url: string;
  body: {
    resourceSpans: {
      resource: { attributes: { key: string; value: unknown }[] };
      scopeSpans: {
        scope: { name: string };
        spans: {
          traceId: string;
          spanId: string;
          parentSpanId?: string;
          name: string;
          kind: number;
          status?: { code: number };
          attributes: { key: string; value: unknown }[];
        }[];
      }[];
    }[];
  };
}

function captureFetch() {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }),
  );
  return captured;
}

function makeSink(log?: (msg: string) => void) {
  const target = parseOtlpTarget(env)!;
  const ctx = stepOtelContext('build-abc', 'step-xyz', target);
  return { sink: new PiStepSpanSink(ctx, { provider: 'stub-gw', model: 'stub-model' }, log), ctx };
}

describe('PiStepSpanSink', () => {
  test('pushes chat and execute_tool spans under the step span', async () => {
    const { sink, ctx } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, {
      provider: 'anthropic',
      model: 'claude-sonnet',
      responseModel: 'claude-sonnet-4-5',
      finishReason: 'stop',
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
      costUsd: 0.01,
    });
    sink.toolStart('call-1', 1100, 'bash', { command: 'ls' });
    sink.toolEnd('call-1', 1500, 'file.txt', false);
    await sink.flush();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
    const scope = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!;
    expect(captured[0]!.body.resourceSpans[0]!.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
    ]);
    expect(scope.scope.name).toBe('cairn.daemon');
    expect(scope.spans).toHaveLength(2);
    const chat = scope.spans[0]!;
    expect(chat.traceId).toBe(ctx.traceId);
    expect(chat.parentSpanId).toBe(ctx.stepSpanId);
    expect(chat.name).toBe('chat claude-sonnet');
    expect(chat.kind).toBe(3);
    const chatAttrs = Object.fromEntries(chat.attributes.map((a) => [a.key, a.value]));
    expect(chatAttrs['gen_ai.operation.name']).toEqual({ stringValue: 'chat' });
    expect(chatAttrs['gen_ai.provider.name']).toEqual({ stringValue: 'anthropic' });
    expect(chatAttrs['gen_ai.request.model']).toEqual({ stringValue: 'claude-sonnet' });
    expect(chatAttrs['gen_ai.response.model']).toEqual({ stringValue: 'claude-sonnet-4-5' });
    expect(chatAttrs['gen_ai.usage.input_tokens']).toEqual({ intValue: '13' });
    expect(chatAttrs['gen_ai.usage.output_tokens']).toEqual({ intValue: '5' });
    expect(chatAttrs['gen_ai.usage.cache_read.input_tokens']).toEqual({ intValue: '2' });
    const tool = scope.spans[1]!;
    expect(tool.traceId).toBe(ctx.traceId);
    expect(tool.parentSpanId).toBe(ctx.stepSpanId);
    expect(tool.name).toBe('execute_tool bash');
    expect(tool.kind).toBe(1);
    const toolAttrs = Object.fromEntries(tool.attributes.map((a) => [a.key, a.value]));
    expect(toolAttrs['gen_ai.operation.name']).toEqual({ stringValue: 'execute_tool' });
    expect(toolAttrs['gen_ai.tool.name']).toEqual({ stringValue: 'bash' });
    expect(toolAttrs['gen_ai.tool.call.id']).toEqual({ stringValue: 'call-1' });
    expect(toolAttrs['gen_ai.tool.call.arguments']).toEqual({
      stringValue: JSON.stringify({ command: 'ls' }),
    });
    expect(toolAttrs['gen_ai.tool.call.result']).toEqual({ stringValue: 'file.txt' });
  });

  test('marks error turns and failed tools', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, { provider: 'anthropic', model: 'claude', finishReason: 'error' });
    sink.toolStart('call-2', 1100, 'bash', 'ls');
    sink.toolEnd('call-2', 1200, 'boom', true);
    await sink.flush();
    const spans = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[1]?.status?.code).toBe(2);
  });

  test('falls back to the session model when the turn has none', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, { finishReason: 'stop', usage: { input: 1 } });
    await sink.flush();
    const chat = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    const attrs = Object.fromEntries(chat.attributes.map((a) => [a.key, a.value]));
    expect(attrs['gen_ai.provider.name']).toEqual({ stringValue: 'stub-gw' });
    expect(attrs['gen_ai.request.model']).toEqual({ stringValue: 'stub-model' });
    expect(chat.name).toBe('chat stub-model');
  });

  test('redacts secrets from tool results before pushing', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.toolStart('call-3', 1000, 'bash', 'curl');
    sink.toolEnd('call-3', 1100, 'token Bearer abcdef0123456789abcdef0123456789abcdef01', false);
    await sink.flush();
    const raw = JSON.stringify(captured[0]);
    expect(raw).not.toContain('Bearer abcdef');
    expect(raw).toContain('[REDACTED]');
  });

  test('skips the POST when no spans were recorded', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    await sink.flush();
    expect(captured).toEqual([]);
  });

  test('swallows push failures and reports them to the log', async () => {
    const logs: string[] = [];
    const { sink } = makeSink((msg) => logs.push(msg));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    sink.chat(1000, { provider: 'p', model: 'm', finishReason: 'stop' });
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('503'))).toBe(true);
  });
});
