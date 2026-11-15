import {
  type Attributes,
  chatAttributes,
  executeToolAttributes,
  langfuseEnvironmentAttributes,
  observationAttributes,
  otelEnvironment,
  otelResourceAttributes,
  type ProviderModelRef,
  redactSecrets,
  type TokenCounts,
} from '@cairn/shared';
import {
  type CairnSpan,
  type CairnTracing,
  createCairnTracing,
  parseOtlpTarget,
  type StepOtelContext,
  stepOtelContext,
  traceparentFor,
} from '@cairn/shared/otel';

const SCOPE = 'cairn.daemon';

const tracings = new Map<string, CairnTracing>();

function tracingFor(ctx: StepOtelContext, log?: (message: string) => void): CairnTracing {
  const environment = ctx.environment ?? null;
  const key = JSON.stringify([ctx.tracesUrl, ctx.headers, environment]);
  let tracing = tracings.get(key);
  if (tracing === undefined) {
    tracing = createCairnTracing(
      { url: new URL(ctx.tracesUrl), headers: ctx.headers },
      otelResourceAttributes(environment),
      SCOPE,
      (error) => log?.(`otel push failed: ${error.message}`),
    );
    tracings.set(key, tracing);
  }
  return tracing;
}

export async function flushDaemonOtel(): Promise<void> {
  await Promise.all([...tracings.values()].map((tracing) => tracing.forceFlush()));
}

export async function shutdownDaemonOtel(): Promise<void> {
  const open = [...tracings.values()];
  tracings.clear();
  await Promise.all(open.map((tracing) => tracing.shutdown()));
}

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
    TRACEPARENT: traceparentFor(ctx.traceId, ctx.stepSpanId),
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
  private readonly spans: CairnSpan[] = [];
  private input: Attributes = {};
  private readonly openTools = new Map<string, OpenToolSpan>();

  constructor(
    private readonly ctx: StepOtelContext,
    private readonly fallback: ProviderModelRef,
    private readonly log?: (msg: string) => void,
    private readonly redact?: <T>(value: T) => T,
  ) {}

  private get parent() {
    return { traceId: this.ctx.traceId, spanId: this.ctx.stepSpanId };
  }

  request(messages: unknown): void {
    this.input = observationAttributes({ input: this.redact?.(messages) ?? messages });
  }

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
      output?: unknown;
    },
  ): void {
    const model = turn.model ?? this.fallback.model ?? '';
    this.spans.push({
      parent: this.parent,
      name: `chat ${model}`.trim(),
      kind: 'client',
      startMs: at,
      endMs: at,
      attributes: {
        ...chatAttributes(turn, this.fallback),
        ...this.input,
        ...observationAttributes({ output: this.redact?.(turn.output) ?? turn.output }),
        ...langfuseEnvironmentAttributes(this.ctx.environment),
      },
      ...(turn.finishReason === 'error' ? { error: 'error' } : {}),
    });
    this.input = {};
  }

  toolStart(id: string, at: number, name: string, args: unknown): void {
    if (this.openTools.has(id)) return;
    this.openTools.set(id, { name, args, at });
  }

  toolEnd(id: string, at: number, result: unknown, isError: boolean): void {
    const open = this.openTools.get(id);
    if (open === undefined) return;
    this.openTools.delete(id);
    this.spans.push({
      parent: this.parent,
      name: `execute_tool ${open.name}`,
      kind: 'internal',
      startMs: open.at,
      endMs: Math.max(open.at, at),
      attributes: {
        ...executeToolAttributes({
          name: open.name,
          callId: id,
          arguments: jsonText(open.args),
          result: jsonText(result),
        }),
        ...langfuseEnvironmentAttributes(this.ctx.environment),
      },
      ...(isError ? { error: 'tool error' } : {}),
    });
  }

  async flush(): Promise<void> {
    const now = Date.now();
    for (const id of [...this.openTools.keys()]) {
      this.toolEnd(id, now, undefined, false);
    }
    if (this.spans.length === 0) return;
    try {
      const spans = this.spans.splice(0);
      const redacted = redactSecrets(this.redact?.(spans) ?? spans).value as CairnSpan[];
      tracingFor(this.ctx, this.log).record(redacted);
    } catch (error) {
      this.log?.(`otel push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
