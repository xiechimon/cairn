import { randomBytes } from 'node:crypto';
import {
  chatAttributes,
  executeToolAttributes,
  type ProviderModelRef,
  redactSecrets,
  type TokenCounts,
} from '@cairn/shared';
import {
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpSpan,
  type OtlpTarget,
  otlpAttributes,
  otlpNanos,
  otlpTraceparent,
  otlpTracesRequest,
  parseOtlpTarget,
  postOtlpTraces,
  type StepOtelContext,
  stepOtelContext,
} from '@cairn/shared/otel';

const SCOPE = 'cairn.daemon';
const RESOURCE = { 'service.name': 'cairn' } as const;

export interface DaemonOtel {
  contextFor(buildId: string, stepId: string): StepOtelContext;
}

export function daemonOtelFromEnv(env: NodeJS.ProcessEnv): DaemonOtel | null {
  const target = parseOtlpTarget(env);
  if (target === null) return null;
  return { contextFor: (buildId, stepId) => stepOtelContext(buildId, stepId, target) };
}

export function claudeTelemetryEnv(ctx: StepOtelContext): Record<string, string> {
  return {
    TRACEPARENT: otlpTraceparent(ctx.traceId, ctx.stepSpanId),
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_ENDPOINT: ctx.exporterEndpoint,
    OTEL_EXPORTER_OTLP_HEADERS: ctx.exporterHeaders,
  };
}

interface OpenToolSpan {
  name: string;
  args: unknown;
  at: number;
}

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

export class PiStepSpanSink {
  private readonly spans: OtlpSpan[] = [];
  private readonly openTools = new Map<string, OpenToolSpan>();

  constructor(
    private readonly ctx: StepOtelContext,
    private readonly fallback: ProviderModelRef,
    private readonly log?: (msg: string) => void,
  ) {}

  chat(
    at: number,
    turn: {
      provider?: string;
      model?: string;
      responseModel?: string;
      finishReason?: string;
      rawFinishReason?: string;
      usage?: TokenCounts;
      costUsd?: number;
    },
  ): void {
    const model = turn.model ?? this.fallback.model ?? '';
    this.spans.push({
      traceId: this.ctx.traceId,
      spanId: randomBytes(8).toString('hex'),
      parentSpanId: this.ctx.stepSpanId,
      name: `chat ${model}`.trim(),
      kind: OTLP_SPAN_KIND.client,
      startTimeUnixNano: otlpNanos(at),
      endTimeUnixNano: otlpNanos(at),
      attributes: otlpAttributes(chatAttributes(turn, this.fallback)),
      ...(turn.finishReason === 'error'
        ? { status: { code: OTLP_STATUS_ERROR, message: 'error' } }
        : {}),
    });
  }

  toolStart(id: string, at: number, name: string, args: unknown): void {
    if (this.openTools.has(id)) return;
    this.openTools.set(id, { name, args, at });
  }

  toolEnd(id: string, at: number, result: unknown, isError: boolean): void {
    const open = this.openTools.get(id);
    if (open === undefined) return;
    this.openTools.delete(id);
    const start = open.at;
    const end = Math.max(start, at);
    this.spans.push({
      traceId: this.ctx.traceId,
      spanId: randomBytes(8).toString('hex'),
      parentSpanId: this.ctx.stepSpanId,
      name: `execute_tool ${open.name}`,
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(start),
      endTimeUnixNano: otlpNanos(end),
      attributes: otlpAttributes(
        executeToolAttributes({
          name: open.name,
          callId: id,
          arguments: jsonText(open.args),
          result: jsonText(result),
        }),
      ),
      ...(isError ? { status: { code: OTLP_STATUS_ERROR, message: 'tool error' } } : {}),
    });
  }

  async flush(): Promise<void> {
    const now = Date.now();
    for (const id of [...this.openTools.keys()]) {
      this.toolEnd(id, now, undefined, false);
    }
    if (this.spans.length === 0) return;
    const target: OtlpTarget = { url: new URL(this.ctx.tracesUrl), headers: this.ctx.headers };
    const request = redactSecrets(otlpTracesRequest(RESOURCE, SCOPE, this.spans))
      .value as ReturnType<typeof otlpTracesRequest>;
    try {
      await postOtlpTraces(target, request);
    } catch (error) {
      this.log?.(`otel push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
