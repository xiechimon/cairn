import { randomBytes } from 'node:crypto';
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
  createOtlpSender,
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpSpan,
  type OtlpTarget,
  otlpAttributes,
  otlpNanos,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfStep,
  otlpTracesRequest,
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
const sender = createOtlpSender();

function runtimeTarget(env: NodeJS.ProcessEnv): OtlpTarget | null {
  try {
    return parseOtlpTarget(env);
  } catch {
    return null;
  }
}

function push(target: OtlpTarget, env: NodeJS.ProcessEnv, spans: OtlpSpan[]): void {
  if (spans.length === 0) return;
  sender.send(
    target,
    otlpTracesRequest(otelResourceAttributes(otelEnvironment(env)), SCOPE, spans),
  );
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
  const status =
    row.status === 'failed'
      ? { status: { code: OTLP_STATUS_ERROR, message: errorMessage ?? 'failed' } }
      : {};
  push(target, env, [
    {
      traceId: otlpTraceIdOfStep({ kind: row.kind, buildId: row.buildId, stepId: row.id }),
      spanId: otlpStepSpanIdOfBuild(row.buildId, row.id),
      ...(isTurn ? {} : { parentSpanId: otlpRootSpanIdOfBuild(row.buildId) }),
      name: isTurn ? COORDINATOR_TURN_SPAN : `step ${row.kind}`,
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(start),
      endTimeUnixNano: otlpNanos(end),
      attributes: otlpAttributes({
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
      }),
      ...status,
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
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(start),
      endTimeUnixNano: otlpNanos(end),
      attributes: otlpAttributes({
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
      }),
      ...(outcome === 'done'
        ? {}
        : { status: { code: OTLP_STATUS_ERROR, message: errorMessage ?? outcome } }),
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
  const traceId = otlpTraceIdOfStep({ kind: 'chief', buildId: turn.threadId, stepId: turn.stepId });
  const parentSpanId = otlpStepSpanIdOfBuild(turn.threadId, turn.stepId);
  const spans: OtlpSpan[] = records.map((record) => {
    if (record.kind === 'chat') {
      return {
        traceId,
        spanId: randomBytes(8).toString('hex'),
        parentSpanId,
        name: `chat ${record.model}`.trim(),
        kind: OTLP_SPAN_KIND.client,
        startTimeUnixNano: otlpNanos(record.at),
        endTimeUnixNano: otlpNanos(record.at),
        attributes: otlpAttributes({
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
        }),
        ...(record.finishReason === 'error'
          ? {
              status: {
                code: OTLP_STATUS_ERROR,
                message: otelErrorMessage(record.errorMessage) ?? 'error',
              },
            }
          : {}),
      };
    }
    return {
      traceId,
      spanId: randomBytes(8).toString('hex'),
      parentSpanId,
      name: `execute_tool ${record.name}`,
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(record.startAt),
      endTimeUnixNano: otlpNanos(Math.max(record.startAt, record.endAt)),
      attributes: otlpAttributes({
        ...executeToolAttributes({
          name: record.name,
          callId: record.id,
          arguments: jsonText(record.arguments),
          result: jsonText(record.result),
        }),
        ...langfuseEnvironmentAttributes(environment),
      }),
      ...(record.isError ? { status: { code: OTLP_STATUS_ERROR, message: 'tool error' } } : {}),
    };
  });
  const request = otlpTracesRequest(otelResourceAttributes(environment), SCOPE, spans);
  const redacted = redactSecrets(request).value as typeof request;
  sender.send(target, redacted);
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
  const span: OtlpSpan = {
    traceId: inTurn
      ? otlpTraceIdOfStep({
          kind: 'chief',
          buildId: failure.threadId ?? '',
          stepId: failure.stepId ?? '',
        })
      : otlpTraceIdOfBuild(failure.threadId ?? 'coordinator'),
    spanId: randomBytes(8).toString('hex'),
    ...(inTurn
      ? { parentSpanId: otlpStepSpanIdOfBuild(failure.threadId ?? '', failure.stepId ?? '') }
      : {}),
    name: `compaction ${failure.stage}`,
    kind: OTLP_SPAN_KIND.internal,
    startTimeUnixNano: otlpNanos(now),
    endTimeUnixNano: otlpNanos(now),
    attributes: otlpAttributes({
      'cairn.compaction.stage': failure.stage,
      'cairn.compaction.failure_count': failure.count,
      'error.type': failure.errorClass,
      ...langfuseEnvironmentAttributes(environment),
    }),
    status: { code: OTLP_STATUS_ERROR, message: failure.message },
  };
  const request = otlpTracesRequest(otelResourceAttributes(environment), SCOPE, [span]);
  sender.send(target, redactSecrets(request).value as typeof request);
}
