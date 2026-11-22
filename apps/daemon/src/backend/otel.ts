import {
  chatAttributes,
  executeToolAttributes,
  LANGFUSE_ATTR,
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
  otelConfigEnv,
  parseOtlpTarget,
  type StepOtelContext,
  stepOtelContext,
  traceparentFor,
} from '@cairn/shared/otel';
import { childEnv } from '../child-env.js';

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
  const resolved = otelConfigEnv(env);
  const target = parseOtlpTarget(resolved);
  if (target === null) return null;
  const environment = otelEnvironment(resolved);
  return {
    contextFor: (buildId, stepId, kind) =>
      stepOtelContext(buildId, stepId, target, {
        environment,
        ...(kind !== undefined ? { kind } : {}),
      }),
  };
}

export const CLAUDE_TELEMETRY_PINS: Record<string, string> = {
  OTEL_SDK_DISABLED: 'true',
  CLAUDE_CODE_ENABLE_TELEMETRY: '0',
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
  ENABLE_BETA_TRACING_DETAILED: '0',
  BETA_TRACING_ENDPOINT: '',
};

export function claudeTelemetryEnv(ctx: StepOtelContext): Record<string, string> {
  return {
    TRACEPARENT: traceparentFor(ctx.traceId, ctx.stepSpanId),
    ...CLAUDE_TELEMETRY_PINS,
  };
}

const CLI_EXPORT_KEY = /^(OTEL_|CAIRN_OTEL_|ANT_OTEL_|BETA_TRACING_|ENABLE_BETA_TRACING_)/;

export function runtimeChildEnv(
  extra: NodeJS.ProcessEnv = {},
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(extra)) {
    if (CLI_EXPORT_KEY.test(key)) continue;
    if (
      extra.CAIRN_GIT_CRED_FILE &&
      ['GH_TOKEN', 'GITHUB_TOKEN', 'CAIRN_GIT_CRED_PASSWORD'].includes(key)
    )
      continue;
    filtered[key] = value;
  }
  return childEnv(
    {
      ...filtered,
      SSH_AUTH_SOCK: '',
      SSH_AGENT_PID: '',
      OTEL_SDK_DISABLED: 'true',
    },
    parent,
  );
}

export function claudeCliEnv(
  extra: NodeJS.ProcessEnv = {},
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    ...runtimeChildEnv(extra, parent),
    ...CLAUDE_TELEMETRY_PINS,
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
      input?: unknown;
      output?: unknown;
      endAt?: number;
      firstTokenAt?: number;
    },
  ): void {
    const model = turn.model ?? this.fallback.model ?? '';
    this.spans.push({
      parent: this.parent,
      name: `chat ${model}`.trim(),
      kind: 'client',
      startMs: at,
      endMs: Math.max(at, turn.endAt ?? at),
      attributes: {
        ...chatAttributes(turn, this.fallback),
        ...observationAttributes({
          input: this.redact?.(turn.input) ?? turn.input,
          output: this.redact?.(turn.output) ?? turn.output,
        }),
        ...(turn.firstTokenAt === undefined
          ? {}
          : { [LANGFUSE_ATTR.completionStartTime]: new Date(turn.firstTokenAt).toISOString() }),
        ...langfuseEnvironmentAttributes(this.ctx.environment),
      },
      ...(turn.finishReason === 'error' ? { error: 'error' } : {}),
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

  async flush(final = true): Promise<void> {
    const now = Date.now();
    if (final) {
      for (const id of [...this.openTools.keys()]) {
        this.toolEnd(id, now, undefined, false);
      }
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
