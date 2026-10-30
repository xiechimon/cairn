import { GENAI_OPERATION, runtimeBuildAttributes, stepAttributes } from '@cairn/shared';
import {
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpSpan,
  type OtlpTarget,
  otlpAttributes,
  otlpNanos,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTracesRequest,
  parseOtlpTarget,
  postOtlpTraces,
} from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, step, todo } from './db/schema.js';

const SCOPE = 'cairn.server';
const RESOURCE = { 'service.name': 'cairn' } as const;

function runtimeTarget(env: NodeJS.ProcessEnv): OtlpTarget | null {
  try {
    return parseOtlpTarget(env);
  } catch {
    return null;
  }
}

function push(target: OtlpTarget, spans: OtlpSpan[]): void {
  if (spans.length === 0) return;
  void postOtlpTraces(target, otlpTracesRequest(RESOURCE, SCOPE, spans)).catch(() => {});
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
  const start = row.claimedAt;
  const end = Math.max(start, row.finishedAt ?? Date.now());
  push(target, [
    {
      traceId: otlpTraceIdOfBuild(row.buildId),
      spanId: otlpStepSpanIdOfBuild(row.buildId, row.id),
      parentSpanId: otlpRootSpanIdOfBuild(row.buildId),
      name: `step ${row.kind}`,
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(start),
      endTimeUnixNano: otlpNanos(end),
      attributes: otlpAttributes(
        stepAttributes({
          stepId: row.id,
          kind: row.kind,
          checkpointCommit: row.checkpointCommit,
        }),
      ),
      ...(row.status === 'failed'
        ? { status: { code: OTLP_STATUS_ERROR, message: 'failed' } }
        : {}),
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
  push(target, [
    {
      traceId: otlpTraceIdOfBuild(row.id),
      spanId: otlpRootSpanIdOfBuild(row.id),
      name: GENAI_OPERATION.invokeAgent,
      kind: OTLP_SPAN_KIND.internal,
      startTimeUnixNano: otlpNanos(start),
      endTimeUnixNano: otlpNanos(end),
      attributes: otlpAttributes(
        runtimeBuildAttributes({
          buildId: row.id,
          baseSha: row.baseSha,
          harnessHash: row.harnessHash,
          agentName: todoRow?.title,
        }),
      ),
      ...(outcome === 'done' ? {} : { status: { code: OTLP_STATUS_ERROR, message: outcome } }),
    },
  ]);
}
