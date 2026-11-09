import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LANGFUSE_ATTR } from '@cairn/shared';
import {
  OtlpTargetConfigError,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfTurn,
  parseOtlpTarget,
  stepOtelContext,
  traceparentFor,
} from '@cairn/shared/otel';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  claudeCliEnv,
  claudeTelemetryEnv,
  daemonOtelFromEnv,
  flushDaemonOtel,
  PiStepSpanSink,
  shutdownDaemonOtel,
} from '../src/backend/otel.js';

const env = {
  CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
  CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
};

const received: CapturedRequest[] = [];
const servers: Server[] = [];
let collector = '';
let refusing = '';
let silent = '';

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://pk:sk@127.0.0.1:${(server.address() as AddressInfo).port}/api/public/otel`;
}

beforeAll(async () => {
  collector = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        url: `http://127.0.0.1${req.url ?? ''}`,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  refusing = await listen((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = 400;
      res.end('{}');
    });
  });
  silent = await listen(() => {});
});

afterAll(async () => {
  await shutdownDaemonOtel();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
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

test('Claude child environment keeps its telemetry scrub and unrelated variables', () => {
  const source = {
    ...env,
    CAIRN_OTEL_ENVIRONMENT: 'production',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
    OTEL_SDK_DISABLED: 'false',
    ANT_OTEL_ENDPOINT: 'http://127.0.0.1:9',
    BETA_TRACING_ENDPOINT: 'http://127.0.0.1:9',
    ENABLE_BETA_TRACING_DETAILED: '1',
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    PATH: '/usr/bin',
    HOME: '/synthetic/home',
    FOO: 'bar',
    TRACEPARENT: 'existing-traceparent',
    UNSET: undefined,
  };
  expect(claudeCliEnv(source)).toEqual({
    PATH: '/usr/bin',
    HOME: '/synthetic/home',
    FOO: 'bar',
    TRACEPARENT: 'existing-traceparent',
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
    OTEL_SDK_DISABLED: 'true',
    ENABLE_BETA_TRACING_DETAILED: '0',
    BETA_TRACING_ENDPOINT: '',
  });
  expect(source.CAIRN_OTEL_ENDPOINT).toBe(env.CAIRN_OTEL_ENDPOINT);
  expect(source.OTEL_SDK_DISABLED).toBe('false');
});

describe('claudeTelemetryEnv', () => {
  test('injects TRACEPARENT while disabling unredacted CLI telemetry', () => {
    const target = parseOtlpTarget(env)!;
    const ctx = stepOtelContext('build-abc', 'step-xyz', target);
    const injected = claudeTelemetryEnv(ctx);
    expect(injected.TRACEPARENT).toBe(traceparentFor(ctx.traceId, ctx.stepSpanId));
    expect(injected.TRACEPARENT).toBe('00-c8e7752b66c5938fc686748fdc429fb0-68de601387c7a961-01');
    expect(injected.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('0');
    expect(injected.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe('0');
    expect(injected.OTEL_SDK_DISABLED).toBe('true');
    expect(injected.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(injected.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
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
  received.splice(0);
  return received;
}

function makeSink(log?: (msg: string) => void, endpoint = collector) {
  const target = parseOtlpTarget({ ...env, CAIRN_OTEL_ENDPOINT: endpoint })!;
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
    await flushDaemonOtel();
    expect(captured).toHaveLength(1);
    expect(new URL(captured[0]?.url ?? '').pathname).toBe('/api/public/otel/v1/traces');
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
    expect(chatAttrs['gen_ai.usage.input_tokens']).toEqual({ intValue: 13 });
    expect(chatAttrs['gen_ai.usage.output_tokens']).toEqual({ intValue: 5 });
    expect(chatAttrs['gen_ai.usage.cache_read.input_tokens']).toEqual({ intValue: 2 });
    expect(chatAttrs['langfuse.observation.cost_details']).toEqual({
      stringValue: '{"total":0.01}',
    });
    expect(chatAttrs['gen_ai.usage.cost']).toBeUndefined();
    expect(chatAttrs['cairn.cost_usd']).toBeUndefined();
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
    await flushDaemonOtel();
    const spans = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[1]?.status?.code).toBe(2);
  });

  test('falls back to the session model when the turn has none', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, { finishReason: 'stop', usage: { input: 1 } });
    await sink.flush();
    await flushDaemonOtel();
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
    await flushDaemonOtel();
    const raw = JSON.stringify(captured[0]);
    expect(raw).not.toContain('Bearer abcdef');
    expect(raw).toContain('[REDACTED]');
  });

  test('skips the POST when no spans were recorded', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    await sink.flush();
    await flushDaemonOtel();
    expect(captured).toEqual([]);
  });

  test('swallows push failures and reports them to the log', async () => {
    const logs: string[] = [];
    const { sink } = makeSink((msg) => logs.push(msg), refusing);
    sink.chat(1000, { provider: 'p', model: 'm', finishReason: 'stop' });
    await expect(sink.flush()).resolves.toBeUndefined();
    await flushDaemonOtel();
    expect(logs.some((l) => l.startsWith('otel push failed'))).toBe(true);
  });

  test('observation payloads are redacted and bounded on the SDK wire', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.request([
      {
        role: 'user',
        content: { token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', text: '🧪'.repeat(12_000) },
      },
    ]);
    sink.chat(1000, { output: { role: 'assistant', content: 'answer '.repeat(8_000) } });
    await sink.flush();
    await flushDaemonOtel();
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    for (const key of [LANGFUSE_ATTR.input, LANGFUSE_ATTR.output]) {
      const value = span.attributes.find((attribute) => attribute.key === key)?.value as {
        stringValue: string;
      };
      expect(Buffer.byteLength(value.stringValue)).toBeLessThanOrEqual(32_768);
      expect(() => JSON.parse(value.stringValue)).not.toThrow();
      expect(value.stringValue).toContain('[truncated]');
    }
    expect(JSON.stringify(span)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  test('a second flush does not export the same completed spans again', async () => {
    const { sink } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, { finishReason: 'stop' });
    await sink.flush();
    await flushDaemonOtel();
    await sink.flush();
    await flushDaemonOtel();
    expect(captured).toHaveLength(1);
  });

  test('daemon shutdown delivers spans a step flushed just before it', async () => {
    const { sink, ctx } = makeSink();
    const captured = captureFetch();
    sink.chat(1000, { provider: 'p', model: 'm', finishReason: 'stop' });
    void sink.flush();
    await shutdownDaemonOtel();
    const spans = captured.flatMap((r) => r.body.resourceSpans[0]!.scopeSpans[0]!.spans);
    expect(spans.map((s) => [s.traceId, s.parentSpanId])).toEqual([[ctx.traceId, ctx.stepSpanId]]);
  });
});

describe('Coordinator turn context', () => {
  test('a chief step gets its own trace and the configured environment', () => {
    const otel = daemonOtelFromEnv({ ...env, CAIRN_OTEL_ENVIRONMENT: 'Staging' })!;
    const ctx = otel.contextFor('chief-thread-1', 'step-turn', 'chief');
    expect(ctx.traceId).toBe(otlpTraceIdOfTurn('step-turn'));
    expect(ctx.traceId).not.toBe(otlpTraceIdOfBuild('chief-thread-1'));
    expect(ctx.environment).toBe('staging');
  });

  test('ignores an environment Langfuse would reject', () => {
    const otel = daemonOtelFromEnv({ ...env, CAIRN_OTEL_ENVIRONMENT: 'langfuse-x' })!;
    expect(otel.contextFor('b', 's', 'build').environment).toBeUndefined();
  });

  test('chat and tool spans of a turn carry the environment and a redacted payload', async () => {
    const otel = daemonOtelFromEnv({
      ...env,
      CAIRN_OTEL_ENDPOINT: collector,
      CAIRN_OTEL_ENVIRONMENT: 'prod',
    })!;
    const ctx = otel.contextFor('chief-thread-1', 'step-turn', 'chief');
    const sink = new PiStepSpanSink(ctx, { provider: 'anthropic', model: 'claude-opus' });
    const captured = captureFetch();
    sink.chat(1000, { finishReason: 'stop', usage: { input: 3, output: 2 } });
    sink.toolStart('c1', 1100, 'list_todos', { token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' });
    sink.toolEnd('c1', 1200, 'ok', false);
    await sink.flush();
    await flushDaemonOtel();
    const request = captured[0]!.body.resourceSpans[0]!;
    expect(request.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
      { key: 'deployment.environment', value: { stringValue: 'prod' } },
    ]);
    const spans = request.scopeSpans[0]!.spans;
    expect(spans.map((span) => span.name)).toEqual(['chat claude-opus', 'execute_tool list_todos']);
    for (const span of spans) {
      expect(span.traceId).toBe(otlpTraceIdOfTurn('step-turn'));
      const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
      expect(attrs['langfuse.environment']).toEqual({ stringValue: 'prod' });
    }
    expect(JSON.stringify(captured[0]!.body)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  test('an unreachable collector never delays or fails the sink', async () => {
    const otel = daemonOtelFromEnv({ ...env, CAIRN_OTEL_ENDPOINT: silent })!;
    const ctx = otel.contextFor('chief-thread-1', 'step-turn', 'chief');
    const sink = new PiStepSpanSink(ctx, { provider: 'p', model: 'm' });
    sink.chat(1, { finishReason: 'stop' });
    const started = Date.now();
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(200);
  });
});
