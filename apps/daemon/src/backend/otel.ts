import { randomBytes } from 'node:crypto';
import {
  chatAttributes,
  executeToolAttributes,
  langfuseEnvironmentAttributes,
  otelEnvironment,
  otelResourceAttributes,
  type ProviderModelRef,
  redactSecrets,
  type TokenCounts,
} from '@cairn/shared';
import {
  createOtlpSender,
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpSender,
  type OtlpSpan,
  type OtlpTarget,
  otlpAttributes,
  otlpNanos,
  otlpTraceparent,
  otlpTracesRequest,
  parseOtlpTarget,
  type StepOtelContext,
  stepOtelContext,
} from '@cairn/shared/otel';

const SCOPE = 'cairn.daemon';

const sender = createOtlpSender();

export interface DaemonOtel {
  contextFor(buildId: string, stepId: string, kind?: string): StepOtelContext;
}

export function daemonOtelFromEnv(env: NodeJS.ProcessEnv): DaemonOtel | null {
  const target = parseOtlpTarget(env);
  if (target === null) return null;
  const environment = otelEnvironment(env);
  return {
    contextFor: (buildId, stepId, kind) =>
      stepOtelContext(buildId, stepId, target, {
        environment,
        ...(kind !== undefined ? { kind } : {}),
      }),
  };
}

export function claudeTelemetryEnv(ctx: StepOtelContext): Record<string, string> {
  return {
    TRACEPARENT: otlpTraceparent(ctx.traceId, ctx.stepSpanId),
    ...claudeCliEnv({}),
  };
}

const CLI_EXPORT_KEY = /^(OTEL_|CAIRN_OTEL_|ANT_OTEL_|BETA_TRACING_|ENABLE_BETA_TRACING_)/;

export function runtimeChildEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || CLI_EXPORT_KEY.test(key)) continue;
    if (
      env.CAIRN_GIT_CRED_FILE &&
      ['GH_TOKEN', 'GITHUB_TOKEN', 'CAIRN_GIT_CRED_PASSWORD'].includes(key)
    )
      continue;
    filtered[key] = value;
  }
  return { ...filtered, OTEL_SDK_DISABLED: 'true' };
}

export function claudeCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    ...runtimeChildEnv(env),
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
    ENABLE_BETA_TRACING_DETAILED: '0',
    BETA_TRACING_ENDPOINT: '',
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
    private readonly out: OtlpSender = sender,
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
      attributes: otlpAttributes({
        ...chatAttributes(turn, this.fallback),
        ...langfuseEnvironmentAttributes(this.ctx.environment),
      }),
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
      attributes: otlpAttributes({
        ...executeToolAttributes({
          name: open.name,
          callId: id,
          arguments: jsonText(open.args),
          result: jsonText(result),
        }),
        ...langfuseEnvironmentAttributes(this.ctx.environment),
      }),
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
      const request = otlpTracesRequest(
        otelResourceAttributes(this.ctx.environment),
        SCOPE,
        this.spans,
      );
      const redacted = redactSecrets(this.redact?.(request) ?? request).value as ReturnType<
        typeof otlpTracesRequest
      >;
      const accepted = this.out.send(target, redacted, (error) =>
        this.log?.(`otel push failed: ${error instanceof Error ? error.message : String(error)}`),
      );
      if (!accepted) this.log?.('otel push dropped: export queue is full');
    } catch (error) {
      this.log?.(`otel push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
