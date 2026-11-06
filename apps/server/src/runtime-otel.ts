import {
  coordinatorTurnAttributes,
  GENAI_OPERATION,
  langfuseEnvironmentAttributes,
  langfuseTraceAttributes,
  otelEnvironment,
  otelResourceAttributes,
  runtimeBuildAttributes,
  stepAttributes,
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
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, step, todo } from './db/schema.js';
import { parseChiefTrigger } from './services/chief.js';

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
  const start = row.claimedAt;
  const end = Math.max(start, row.finishedAt ?? Date.now());
  const isTurn = row.kind === 'chief';
  const status =
    row.status === 'failed' ? { status: { code: OTLP_STATUS_ERROR, message: 'failed' } } : {};
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
        ...stepAttributes({
          stepId: row.id,
          kind: row.kind,
          checkpointCommit: row.checkpointCommit,
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
          : langfuseEnvironmentAttributes(environment)),
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
      ...(outcome === 'done' ? {} : { status: { code: OTLP_STATUS_ERROR, message: outcome } }),
    },
  ]);
}
