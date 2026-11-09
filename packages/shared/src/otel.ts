import { createHash } from 'node:crypto';
import {
  type Attributes,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { ExportResultCode, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  type IdGenerator,
  RandomIdGenerator,
  type ReadableSpan,
  type SpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';

export class OtlpTargetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpTargetConfigError';
  }
}

export interface OtlpTarget {
  url: URL;
  headers: Record<string, string>;
}

export function otlpTraceIdOfBuild(buildId: string): string {
  return deriveOtelId(16, 'trace', buildId);
}

export function otlpRootSpanIdOfBuild(buildId: string): string {
  return deriveOtelId(8, 'span', buildId, 'root');
}

export function otlpStepSpanIdOfBuild(buildId: string, stepId: string): string {
  return deriveOtelId(8, 'span', buildId, 'step', stepId);
}

export function otlpChildSpanIdOfBuild(
  buildId: string,
  stepId: string,
  ...path: (string | number)[]
): string {
  return deriveOtelId(8, 'span', buildId, 'step', stepId, ...path);
}

export function otlpTraceIdOfTurn(stepId: string): string {
  return deriveOtelId(16, 'trace', 'turn', stepId);
}

export function otlpTraceIdOfStep(step: { kind: string; buildId: string; stepId: string }): string {
  return step.kind === 'chief' ? otlpTraceIdOfTurn(step.stepId) : otlpTraceIdOfBuild(step.buildId);
}

export function traceparentFor(traceId: string, spanId: string): string {
  const carrier: Record<string, string> = {};
  new W3CTraceContextPropagator().inject(
    trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: TraceFlags.SAMPLED }),
    carrier,
    {
      set: (target, key, value) => {
        target[key] = value;
      },
    },
  );
  return carrier.traceparent ?? '';
}

export function parseOtlpTarget(env: {
  CAIRN_OTEL_ENDPOINT?: string;
  CAIRN_OTEL_HEADERS?: string;
}): OtlpTarget | null {
  const endpoint = env.CAIRN_OTEL_ENDPOINT;
  if (!endpoint) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new OtlpTargetConfigError('CAIRN_OTEL_ENDPOINT is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new OtlpTargetConfigError('CAIRN_OTEL_ENDPOINT must be http or https');
  const base = url.pathname.replace(/\/+$/, '').replace(/\/v1\/traces$/, '');
  url.pathname = `${base}/v1/traces`;
  const headers: Record<string, string> = {};
  if (url.username !== '') {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  for (const pair of (env.CAIRN_OTEL_HEADERS ?? '').split(',').filter((p) => p.trim() !== '')) {
    const separator = pair.indexOf('=');
    if (separator <= 0)
      throw new OtlpTargetConfigError('CAIRN_OTEL_HEADERS must look like name=value,name=value');
    headers[pair.slice(0, separator).trim().toLowerCase()] = pair.slice(separator + 1).trim();
  }
  return { url, headers };
}

export interface StepOtelContext {
  traceId: string;
  stepSpanId: string;
  tracesUrl: string;
  headers: Record<string, string>;
  environment?: string;
}

export function stepOtelContext(
  buildId: string,
  stepId: string,
  target: OtlpTarget,
  options: { kind?: string; environment?: string | null } = {},
): StepOtelContext {
  return {
    traceId: otlpTraceIdOfStep({ kind: options.kind ?? '', buildId, stepId }),
    stepSpanId: otlpStepSpanIdOfBuild(buildId, stepId),
    ...(options.environment != null ? { environment: options.environment } : {}),
    tracesUrl: `${target.url.origin}${target.url.pathname}`,
    headers: target.headers,
  };
}

const EXPORT_TIMEOUT_MS = 5_000;

function deriveOtelId(bytes: number, ...parts: (string | number)[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, bytes * 2);
}

export interface CairnSpan {
  name: string;
  kind: 'internal' | 'client';
  traceId?: string;
  spanId?: string;
  parent?: { traceId: string; spanId: string };
  startMs: number;
  endMs: number;
  attributes: Attributes;
  error?: string;
}

class DerivedIdGenerator implements IdGenerator {
  private readonly random = new RandomIdGenerator();
  private nextTraceId: string | undefined;
  private nextSpanId: string | undefined;

  queue(traceId: string | undefined, spanId: string | undefined): void {
    this.nextTraceId = traceId;
    this.nextSpanId = spanId;
  }

  generateTraceId(): string {
    const id = this.nextTraceId ?? this.random.generateTraceId();
    this.nextTraceId = undefined;
    return id;
  }

  generateSpanId(): string {
    const id = this.nextSpanId ?? this.random.generateSpanId();
    this.nextSpanId = undefined;
    return id;
  }
}

interface SpanRecorder {
  provider: TracerProvider;
  record(spans: readonly CairnSpan[]): void;
}

function spanRecorder(resource: Attributes, scope: string, processor: SpanProcessor): SpanRecorder {
  const ids = new DerivedIdGenerator();
  const provider = new TracerProvider({
    idGenerator: ids,
    resource: resourceFromAttributes(resource),
    spanProcessors: [processor],
  });
  const tracer: Tracer = provider.getTracer(scope);
  const epoch = (ms: number) => new Date(Math.trunc(ms));
  return {
    provider,
    record(spans) {
      for (const span of spans) {
        const parent =
          span.parent === undefined
            ? ROOT_CONTEXT
            : trace.setSpanContext(ROOT_CONTEXT, {
                traceId: span.parent.traceId,
                spanId: span.parent.spanId,
                traceFlags: TraceFlags.SAMPLED,
                isRemote: true,
              });
        ids.queue(span.traceId, span.spanId);
        try {
          const started = tracer.startSpan(
            span.name,
            {
              kind: span.kind === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL,
              startTime: epoch(span.startMs),
              attributes: span.attributes,
            },
            parent,
          );
          if (span.error !== undefined)
            started.setStatus({ code: SpanStatusCode.ERROR, message: span.error });
          started.end(epoch(Math.max(span.startMs, span.endMs)));
        } finally {
          ids.queue(undefined, undefined);
        }
      }
    },
  };
}

function otlpExporter(target: OtlpTarget, timeoutMs: number): OTLPTraceExporter {
  const ambient = Object.entries(process.env).filter(([key]) =>
    key.startsWith('OTEL_EXPORTER_OTLP_'),
  );
  try {
    for (const [key] of ambient) delete process.env[key];
    return new OTLPTraceExporter({
      url: target.url.href,
      headers: target.headers,
      timeoutMillis: timeoutMs,
      httpAgentOptions: { keepAlive: true, timeout: timeoutMs },
    });
  } finally {
    for (const [key, value] of ambient) process.env[key] = value;
  }
}

export async function exportCairnSpans(
  target: OtlpTarget,
  resource: Attributes,
  scope: string,
  spans: readonly CairnSpan[],
  timeoutMs = EXPORT_TIMEOUT_MS,
): Promise<void> {
  const ended: ReadableSpan[] = [];
  const recorder = spanRecorder(resource, scope, {
    onStart: () => {},
    onEnd: (span) => {
      ended.push(span);
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  });
  recorder.record(spans);
  await recorder.provider.shutdown();
  const exporter = otlpExporter(target, timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      exporter.export(ended, (result) => {
        if (result.code === ExportResultCode.SUCCESS) resolve();
        else reject(result.error ?? new Error('OTLP export failed'));
      });
    });
  } finally {
    await exporter.shutdown();
  }
}

export interface CairnTracing {
  record(spans: readonly CairnSpan[]): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createCairnTracing(
  target: OtlpTarget,
  resource: Attributes,
  scope: string,
  onError: (error: Error) => void = () => {},
  timeoutMs = EXPORT_TIMEOUT_MS,
): CairnTracing {
  const processor = new BatchSpanProcessor({
    exporter: otlpExporter(target, timeoutMs),
    exportTimeoutMillis: timeoutMs,
  });
  const recorder = spanRecorder(resource, scope, processor);
  let tail: Promise<void> = Promise.resolve();
  const flush = () => {
    tail = tail
      .then(() => processor.forceFlush())
      .catch((error: unknown) => {
        onError(error instanceof Error ? error : new Error(String(error)));
      });
    return tail;
  };
  return {
    record(spans) {
      if (spans.length === 0) return;
      recorder.record(spans);
      void flush();
    },
    forceFlush: flush,
    async shutdown() {
      await flush();
      await recorder.provider.shutdown();
    },
  };
}
