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
    ...claudeCliEnv({}),
  };
}

export function claudeCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith('OTEL_') || key.startsWith('CAIRN_OTEL_')) continue;
    filtered[key] = value;
  }
  return {
    ...filtered,
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
    OTEL_SDK_DISABLED: 'true',
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
    private readonly redact?: <T>(value: T) => T,
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
    try {
      const request = otlpTracesRequest(RESOURCE, SCOPE, this.spans);
      const redacted = redactSecrets(this.redact?.(request) ?? request).value as ReturnType<
        typeof otlpTracesRequest
      >;
      await postOtlpTraces(target, redacted);
    } catch (error) {
      this.log?.(`otel push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
