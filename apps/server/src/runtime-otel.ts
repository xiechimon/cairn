import {
  chatAttributes,
  chiefTurnErrorContentSchema,
  coordinatorTurnAttributes,
  executeToolAttributes,
  GENAI_OPERATION,
  LANGFUSE_ATTR,
  langfuseEnvironmentAttributes,
  langfuseTraceAttributes,
  otelEnvironment,
  otelErrorMessage,
  otelResourceAttributes,
  redactSecrets,
  runtimeBuildAttributes,
  stepAttributes,
  type TokenCounts,
} from '@cairn/shared';
import {
  type CairnSpan,
  type CairnTracing,
  createCairnTracing,
  type OtlpTarget,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfStep,
  parseOtlpTarget,
} from '@cairn/shared/otel';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, chiefMessage, machine, schedule, step, todo } from './db/schema.js';
import { githubUnattributedCounts } from './lib/github-token.js';
import { parseChiefTrigger } from './services/chief.js';
import { stepRuntimeFor } from './services/dispatch-eligibility.js';
import { storedStepRoute } from './services/step-route.js';

const SCOPE = 'cairn.server';
const COORDINATOR_TURN_SPAN = 'coordinator turn';
const tracings = new Map<string, CairnTracing>();

function runtimeTarget(env: NodeJS.ProcessEnv): OtlpTarget | null {
  try {
    return parseOtlpTarget(env);
  } catch {
    return null;
  }
}

function push(target: OtlpTarget, env: NodeJS.ProcessEnv, spans: CairnSpan[]): void {
  if (spans.length === 0) return;
  const environment = otelEnvironment(env);
  const key = JSON.stringify([target.url.href, target.headers, environment]);
  let tracing = tracings.get(key);
  if (tracing === undefined) {
    tracing = createCairnTracing(target, otelResourceAttributes(environment), SCOPE);
    tracings.set(key, tracing);
  }
  tracing.record(spans);
}

export async function flushRuntimeOtel(): Promise<void> {
  await Promise.all([...tracings.values()].map((tracing) => tracing.forceFlush()));
}

export async function shutdownRuntimeOtel(): Promise<void> {
  const open = [...tracings.values()];
  tracings.clear();
  await Promise.all(open.map((tracing) => tracing.shutdown()));
}

function stepFailureReason(db: Db, row: typeof step.$inferSelect): string | undefined {
  if (row.kind === 'chief') {
    const recorded = db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, `chief-err-${row.id}`))
      .get();
    try {
      const content =
        typeof recorded?.content === 'string' ? JSON.parse(recorded.content) : recorded?.content;
      const parsed = chiefTurnErrorContentSchema.safeParse(content);
      return parsed.success ? otelErrorMessage(parsed.data.message) : undefined;
    } catch {
      return undefined;
    }
  }
  if (row.scheduleId === null) return undefined;
  const recorded = db
    .select()
    .from(schedule)
    .where(and(eq(schedule.id, row.scheduleId), eq(schedule.lastRunStepId, row.id)))
    .get();
  return otelErrorMessage(recorded?.lastRunError);
}

export function emitRuntimeStepSpan(
  db: Db,
  stepId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row || row.claimedAt == null) return;
  const environment = otelEnvironment(env);
  const attribution = Object.fromEntries(
    [...githubUnattributedCounts()].map(([reason, count]) => [
      `cairn.github.write_unattributed.${reason}`,
      count,
    ]),
  );
  const start = row.claimedAt;
  const end = Math.max(start, row.finishedAt ?? Date.now());
  const isTurn = row.kind === 'chief';
  const buildRow = isTurn
    ? undefined
    : db.select().from(build).where(eq(build.id, row.buildId)).get();
  const machineRow =
    !isTurn && row.machineId !== null
      ? db.select({ name: machine.name }).from(machine).where(eq(machine.id, row.machineId)).get()
      : undefined;
  const model = isTurn ? undefined : row.fallback?.model;
  const errorMessage =
    row.status === 'failed'
      ? (stepFailureReason(db, row) ?? otelErrorMessage(buildRow?.errorMessage))
      : undefined;
  const traceId = otlpTraceIdOfStep({ kind: row.kind, buildId: row.buildId, stepId: row.id });
  push(target, env, [
    {
      spanId: otlpStepSpanIdOfBuild(row.buildId, row.id),
      ...(isTurn
        ? { traceId }
        : { parent: { traceId, spanId: otlpRootSpanIdOfBuild(row.buildId) } }),
      name: isTurn ? COORDINATOR_TURN_SPAN : `step ${row.kind}`,
      kind: 'internal',
      startMs: start,
      endMs: end,
      attributes: {
        ...attribution,
        ...stepAttributes({
          stepId: row.id,
          kind: row.kind,
          checkpointCommit: row.checkpointCommit,
          errorMessage,
          route: storedStepRoute(db, row.id),
          ...(isTurn
            ? {}
            : {
                buildId: row.buildId,
                todoId: buildRow?.todoId,
                machineId: row.machineId,
                machineName: machineRow?.name,
                runtime: model ? stepRuntimeFor(model.provider) : undefined,
                provider: model?.provider,
                model: model?.modelId,
              }),
        }),
        ...(isTurn
          ? {
              ...coordinatorTurnAttributes({
                stepId: row.id,
                threadId: row.buildId,
                trigger: parseChiefTrigger(row.prompt),
              }),
              ...langfuseTraceAttributes({
                name: COORDINATOR_TURN_SPAN,
                sessionId: row.buildId,
                tags: ['cairn', 'coordinator'],
                environment,
              }),
            }
          : {
              ...langfuseEnvironmentAttributes(environment),
              ...(buildRow ? { [LANGFUSE_ATTR.sessionId]: buildRow.todoId } : {}),
            }),
      },
      ...(row.status === 'failed' ? { error: errorMessage ?? 'failed' } : {}),
    },
  ]);
}

export function emitRuntimeBuildSpan(
  db: Db,
  buildId: string,
  outcome: 'done' | 'failed' | 'cancelled',
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const row = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) return;
  const todoRow = db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  const errorMessage = outcome === 'done' ? undefined : otelErrorMessage(row.errorMessage);
  const start = row.createdAt;
  const end = Math.max(start, Date.now());
  push(target, env, [
    {
      traceId: otlpTraceIdOfBuild(row.id),
      spanId: otlpRootSpanIdOfBuild(row.id),
      name: GENAI_OPERATION.invokeAgent,
      kind: 'internal',
      startMs: start,
      endMs: end,
      attributes: {
        ...runtimeBuildAttributes({
          buildId: row.id,
          todoId: row.todoId,
          errorMessage,
          baseSha: row.baseSha,
          harnessHash: row.harnessHash,
          agentName: todoRow?.title,
        }),
        ...langfuseTraceAttributes({
          name: 'build',
          sessionId: row.todoId,
          tags: ['cairn', 'build'],
          environment: otelEnvironment(env),
        }),
      },
      ...(outcome === 'done' ? {} : { error: errorMessage ?? outcome }),
    },
  ]);
}

export type CoordinatorTurnSpanRecord =
  | {
      kind: 'chat';
      at: number;
      provider: string;
      model: string;
      responseModel?: string;
      finishReason?: string;
      rawFinishReason?: string;
      usage: TokenCounts;
      costUsd?: number;
      errorMessage?: string;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      arguments: unknown;
      result: unknown;
      isError: boolean;
      startAt: number;
      endAt: number;
    };

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

export function emitCoordinatorTurnSpans(
  turn: { threadId: string; stepId: string; provider: string; model: string },
  records: readonly CoordinatorTurnSpanRecord[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null || records.length === 0) return;
  const environment = otelEnvironment(env);
  const parent = {
    traceId: otlpTraceIdOfStep({ kind: 'chief', buildId: turn.threadId, stepId: turn.stepId }),
    spanId: otlpStepSpanIdOfBuild(turn.threadId, turn.stepId),
  };
  const spans: CairnSpan[] = records.map((record): CairnSpan => {
    if (record.kind === 'chat') {
      return {
        parent,
        name: `chat ${record.model}`.trim(),
        kind: 'client',
        startMs: record.at,
        endMs: record.at,
        attributes: {
          ...chatAttributes(
            {
              provider: record.provider,
              model: record.model,
              ...(record.responseModel !== undefined
                ? { responseModel: record.responseModel }
                : {}),
              ...(record.finishReason !== undefined ? { finishReason: record.finishReason } : {}),
              ...(record.rawFinishReason !== undefined
                ? { rawFinishReason: record.rawFinishReason }
                : {}),
              usage: record.usage,
              ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
            },
            { provider: turn.provider, model: turn.model },
          ),
          ...langfuseEnvironmentAttributes(environment),
        },
        ...(record.finishReason === 'error'
          ? { error: otelErrorMessage(record.errorMessage) ?? 'error' }
          : {}),
      };
    }
    return {
      parent,
      name: `execute_tool ${record.name}`,
      kind: 'internal',
      startMs: record.startAt,
      endMs: Math.max(record.startAt, record.endAt),
      attributes: {
        ...executeToolAttributes({
          name: record.name,
          callId: record.id,
          arguments: jsonText(record.arguments),
          result: jsonText(record.result),
        }),
        ...langfuseEnvironmentAttributes(environment),
      },
      ...(record.isError ? { error: 'tool error' } : {}),
    };
  });
  push(target, env, redactSecrets(spans).value as CairnSpan[]);
}

export function emitCompactionFailureSpan(
  failure: {
    stage: string;
    errorClass: string;
    message: string;
    count: number;
    threadId?: string | undefined;
    stepId?: string | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const environment = otelEnvironment(env);
  const now = Date.now();
  const inTurn = failure.threadId !== undefined && failure.stepId !== undefined;
  const traceId = inTurn
    ? otlpTraceIdOfStep({
        kind: 'chief',
        buildId: failure.threadId ?? '',
        stepId: failure.stepId ?? '',
      })
    : otlpTraceIdOfBuild(failure.threadId ?? 'coordinator');
  const span: CairnSpan = {
    ...(inTurn
      ? {
          parent: {
            traceId,
            spanId: otlpStepSpanIdOfBuild(failure.threadId ?? '', failure.stepId ?? ''),
          },
        }
      : { traceId }),
    name: `compaction ${failure.stage}`,
    kind: 'internal',
    startMs: now,
    endMs: now,
    attributes: {
      'cairn.compaction.stage': failure.stage,
      'cairn.compaction.failure_count': failure.count,
      'error.type': failure.errorClass,
      ...langfuseEnvironmentAttributes(environment),
    },
    error: failure.message,
  };
  push(target, env, redactSecrets([span]).value as CairnSpan[]);
}
