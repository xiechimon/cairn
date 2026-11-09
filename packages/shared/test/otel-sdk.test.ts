import { createServer, type Server } from 'node:http';
import { type AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type CairnSpan,
  createCairnTracing,
  exportCairnSpans,
  type OtlpTarget,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
} from '../src/otel.js';

vi.setConfig({ testTimeout: 20_000 });

interface WireSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  status?: { code?: number; message?: string };
  attributes: { key: string; value: Record<string, unknown> }[];
}

interface Capture {
  target: OtlpTarget;
  requests: { headers: Record<string, string | string[] | undefined>; spans: WireSpan[] }[];
  resources: { key: string }[][];
  scopes: string[];
}

const servers: Server[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) server.close();
});

async function capture(statuses: number[] = []): Promise<Capture> {
  const result: Capture = {
    target: { url: new URL('http://127.0.0.1:1/v1/traces'), headers: {} },
    requests: [],
    resources: [],
    scopes: [],
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const status = statuses.shift() ?? 200;
      if (status === 200) {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const spans: WireSpan[] = [];
        for (const resource of body.resourceSpans) {
          result.resources.push(resource.resource.attributes);
          for (const scope of resource.scopeSpans) {
            result.scopes.push(scope.scope.name);
            spans.push(...scope.spans);
          }
        }
        result.requests.push({ headers: req.headers, spans });
      }
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  result.target = {
    url: new URL(`http://127.0.0.1:${port}/api/public/otel/v1/traces`),
    headers: { authorization: 'Basic cGs6c2s=', 'x-langfuse-ingestion-version': '4' },
  };
  return result;
}

const traceId = otlpTraceIdOfBuild('build-abc');
const rootSpanId = otlpRootSpanIdOfBuild('build-abc');
const stepSpanId = otlpStepSpanIdOfBuild('build-abc', 'step-xyz');

function spans(): CairnSpan[] {
  return [
    {
      name: 'invoke_agent',
      kind: 'internal',
      traceId,
      spanId: rootSpanId,
      startMs: 1_700_000_000_000,
      endMs: 1_700_000_009_000,
      attributes: { 'cairn.build_id': 'build-abc' },
    },
    {
      name: 'step build',
      kind: 'internal',
      spanId: stepSpanId,
      parent: { traceId, spanId: rootSpanId },
      startMs: 1_700_000_001_000,
      endMs: 1_700_000_008_000,
      attributes: { 'cairn.step_id': 'step-xyz' },
      error: 'exit 1',
    },
    {
      name: 'chat m',
      kind: 'client',
      parent: { traceId, spanId: stepSpanId },
      startMs: 1_700_000_002_000,
      endMs: 1_700_000_002_000,
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 12 },
    },
  ];
}

const byName = (list: WireSpan[], name: string) => list.find((span) => span.name === name);

describe('exportCairnSpans', () => {
  test('keeps derived trace and span ids and joins children to a parent from another process', async () => {
    const sink = await capture();
    await exportCairnSpans(sink.target, { 'service.name': 'cairn' }, 'cairn.test', spans());
    const sent = sink.requests.flatMap((r) => r.spans);
    expect(sent).toHaveLength(3);
    const root = byName(sent, 'invoke_agent');
    const step = byName(sent, 'step build');
    const chat = byName(sent, 'chat m');
    expect(root?.traceId).toBe(traceId);
    expect(root?.spanId).toBe(rootSpanId);
    expect(root?.parentSpanId ?? '').toBe('');
    expect(step?.traceId).toBe(traceId);
    expect(step?.spanId).toBe(stepSpanId);
    expect(step?.parentSpanId).toBe(rootSpanId);
    expect(chat?.traceId).toBe(traceId);
    expect(chat?.parentSpanId).toBe(stepSpanId);
    expect(chat?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(chat?.spanId).not.toBe(stepSpanId);
  });

  test('a span under a synthetic remote parent is sampled and exported', async () => {
    const sink = await capture();
    const [, , chat] = spans();
    await exportCairnSpans(sink.target, {}, 'cairn.test', [chat as CairnSpan]);
    expect(sink.requests.flatMap((r) => r.spans).map((s) => s.name)).toEqual(['chat m']);
  });

  test('exports the given epoch times, including epoch 0, never process-relative ones', async () => {
    const sink = await capture();
    await exportCairnSpans(sink.target, {}, 'cairn.test', [
      { name: 'zero', kind: 'internal', startMs: 0, endMs: 0, attributes: {} },
      { name: 'small', kind: 'internal', startMs: 1_000, endMs: 2_500, attributes: {} },
      {
        name: 'backwards',
        kind: 'internal',
        startMs: 1_700_000_000_123,
        endMs: 1_700_000_000_000,
        attributes: {},
      },
    ]);
    const sent = sink.requests.flatMap((r) => r.spans);
    const nanos = (name: string) => {
      const span = byName(sent, name);
      return [String(span?.startTimeUnixNano), String(span?.endTimeUnixNano)];
    };
    expect(nanos('zero')).toEqual(['0', '0']);
    expect(nanos('small')).toEqual(['1000000000', '2500000000']);
    expect(nanos('backwards')).toEqual(['1700000000123000000', '1700000000123000000']);
  });

  test('sends the configured headers, an explicit resource without telemetry.sdk, kinds, status and attributes', async () => {
    const sink = await capture();
    await exportCairnSpans(sink.target, { 'service.name': 'cairn' }, 'cairn.test', spans());
    expect(sink.requests[0]?.headers.authorization).toBe('Basic cGs6c2s=');
    expect(sink.requests[0]?.headers['x-langfuse-ingestion-version']).toBe('4');
    expect(sink.requests[0]?.headers['content-type']).toContain('application/json');
    expect(sink.resources[0]?.map((a) => a.key)).toEqual(['service.name']);
    expect(sink.scopes).toEqual(['cairn.test']);
    const sent = sink.requests.flatMap((r) => r.spans);
    expect(byName(sent, 'chat m')?.kind).toBe(3);
    expect(byName(sent, 'invoke_agent')?.kind).toBe(1);
    expect(byName(sent, 'step build')?.status).toMatchObject({ code: 2, message: 'exit 1' });
    expect(byName(sent, 'invoke_agent')?.status?.code ?? 0).not.toBe(2);
    expect(byName(sent, 'chat m')?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: 12 } },
      ]),
    );
  });

  test('retries a transient 503 and then succeeds', async () => {
    const sink = await capture([503]);
    await exportCairnSpans(sink.target, {}, 'cairn.test', spans());
    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0]?.spans).toHaveLength(3);
  });

  test('rejects when the endpoint keeps refusing', async () => {
    const sink = await capture([400]);
    await expect(exportCairnSpans(sink.target, {}, 'cairn.test', spans())).rejects.toThrow();
  });
});

describe('createCairnTracing', () => {
  test('shutdown resolves only after the queued spans reached the endpoint', async () => {
    const sink = await capture();
    const tracing = createCairnTracing(sink.target, { 'service.name': 'cairn' }, 'cairn.test');
    tracing.record(spans());
    expect(sink.requests).toHaveLength(0);
    await tracing.shutdown();
    expect(sink.requests.flatMap((r) => r.spans)).toHaveLength(3);
  });

  test('forceFlush delivers without shutting the tracer down', async () => {
    const sink = await capture();
    const tracing = createCairnTracing(sink.target, {}, 'cairn.test');
    tracing.record(spans().slice(0, 1));
    await tracing.forceFlush();
    tracing.record(spans().slice(1));
    await tracing.forceFlush();
    expect(sink.requests.flatMap((r) => r.spans).map((s) => s.name)).toEqual([
      'invoke_agent',
      'step build',
      'chat m',
    ]);
    await tracing.shutdown();
  });

  test('reports export failures to the given handler', async () => {
    const sink = await capture([400]);
    const failures: string[] = [];
    const tracing = createCairnTracing(sink.target, {}, 'cairn.test', (error) =>
      failures.push(error.message),
    );
    tracing.record(spans().slice(0, 1));
    await tracing.forceFlush();
    expect(failures).toHaveLength(1);
    await tracing.shutdown();
  });
});

describe('SDK exporter configuration isolation', () => {
  test.each(['direct', 'batched'] as const)(
    '%s excludes ambient collector headers and restores the environment',
    async (mode) => {
      const sink = await capture();
      vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-other-collector=generic,authorization=ambient');
      vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'x-trace-collector=trace');
      if (mode === 'direct') {
        await exportCairnSpans(sink.target, {}, 'cairn.test', spans());
      } else {
        const tracing = createCairnTracing(sink.target, {}, 'cairn.test');
        tracing.record(spans());
        await tracing.shutdown();
      }
      expect(sink.requests[0]?.headers.authorization).toBe(sink.target.headers.authorization);
      expect(sink.requests[0]?.headers['x-other-collector']).toBeUndefined();
      expect(sink.requests[0]?.headers['x-trace-collector']).toBeUndefined();
      expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
        'x-other-collector=generic,authorization=ambient',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBe('x-trace-collector=trace');
    },
  );

  test('restores ambient configuration when exporter construction throws', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-other-collector=generic');
    expect(() =>
      createCairnTracing(
        { url: new URL('http://127.0.0.1'), headers: {} },
        {},
        'cairn.test',
        undefined,
        -1,
      ),
    ).toThrow();
    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe('x-other-collector=generic');
  });

  test('bounds a connection that never reaches TCP connect', async () => {
    const sockets: Socket[] = [];
    const guards: ReturnType<typeof setTimeout>[] = [];
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      Object.defineProperty(this, 'connecting', { value: true, configurable: true });
      sockets.push(this);
      guards.push(setTimeout(() => this.destroy(new Error('connect guard expired')), 800));
      return this;
    });
    const started = Date.now();
    try {
      await expect(
        exportCairnSpans(
          { url: new URL('http://127.0.0.1:1/v1/traces'), headers: {} },
          {},
          'cairn.test',
          spans(),
          50,
        ),
      ).rejects.toThrow();
      expect(sockets.length).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(500);
      expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    } finally {
      for (const guard of guards) clearTimeout(guard);
      for (const socket of sockets) socket.destroy();
    }
  });
});
