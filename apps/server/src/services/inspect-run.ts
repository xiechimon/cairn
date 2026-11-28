import {
  AUTOMATIC_RETRY_ROW_KIND,
  BUILD_FAILURE_ROW_KIND,
  chiefTurnErrorContentSchema,
  redactSecrets,
  type StepFailureDetail,
  systemRowOf,
} from '@cairn/shared';
import {
  otelConfigEnv,
  otlpTraceIdOfBuild,
  otlpTraceIdOfTurn,
  parseOtlpTarget,
} from '@cairn/shared/otel';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  chiefMessage,
  chiefTurnUsage,
  coordinatorTurnSnapshot,
  message,
  step,
  stepUsage,
  todoTransition,
  tokenUsage,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import {
  type BuildOutcome,
  classifyBuildCause,
  failedStepResidualText,
} from '../reliability-report.js';
import { messageText } from './conversation-page.js';
import { resolveRunTarget, type TeamBuild, type TeamThread } from './run-target.js';
import { readManyQuota, type StepQuota } from './step-groups/quota.js';

export const INSPECT_RUN_MAX_OUTPUT_BYTES = 24 * 1024;
const LINE_MAX_CHARS = 400;
const ARGS_MAX_CHARS = 160;
const STEP_LIMIT = 12;
const TURN_LIMIT = 5;
const EVENT_LIMIT = 5;
const TOOL_CALL_LIMIT = 8;
const MESSAGE_SCAN_LIMIT = 200;

type StepRow = typeof step.$inferSelect & StepQuota;

function withQuota(db: Db, rows: (typeof step.$inferSelect)[]): StepRow[] {
  const groups = readManyQuota(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    ...(groups.get(row.id) ?? { quotaBlock: null, fallback: null, ranModel: null }),
  }));
}

interface Evidence {
  source: string;
  at: string | null;
  text: string;
}

const iso = (ms: number | null | undefined): string | null =>
  ms === null || ms === undefined || ms <= 0 ? null : new Date(ms).toISOString();

const clip = (text: string, max = LINE_MAX_CHARS): string => {
  const redacted = String(redactSecrets(text).value);
  const chars = Array.from(redacted);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : redacted;
};

function traceExportConfigured(env: NodeJS.ProcessEnv): boolean {
  try {
    return parseOtlpTarget(otelConfigEnv(env)) !== null;
  } catch {
    return false;
  }
}

function redactedDetail(detail: StepFailureDetail | null): StepFailureDetail | null {
  if (detail === null) return null;
  return {
    ...(detail.runtime !== undefined ? { runtime: clip(detail.runtime, 80) } : {}),
    ...(detail.exitCode !== undefined ? { exitCode: detail.exitCode } : {}),
    ...(detail.signal !== undefined ? { signal: clip(detail.signal, 80) } : {}),
    ...(detail.tool !== undefined ? { tool: clip(detail.tool, 80) } : {}),
    ...(detail.timeoutMs !== undefined ? { timeoutMs: detail.timeoutMs } : {}),
  };
}

function stepLine(row: StepRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    machineId: row.machineId,
    createdAt: iso(row.createdAt),
    claimedAt: iso(row.claimedAt),
    lastProgressAt: iso(row.lastProgressAt),
    finishedAt: iso(row.finishedAt),
    claimCount: row.claimCount,
    holdCount: row.holdCount,
    holdReason: row.holdReason === null ? null : clip(row.holdReason),
    failureCode: row.failureCode,
    quotaWait:
      row.quotaBlock === null
        ? null
        : {
            kind: row.quotaBlock.kind,
            provider: row.quotaBlock.providerId,
            reason: clip(row.quotaBlock.reason),
            attempts: row.quotaBlock.attempts,
            firstSeenAt: iso(row.quotaBlock.firstSeenAt),
            nextProbeAt: iso(row.quotaBlock.probeAt),
          },
    fallback:
      row.fallback === null
        ? null
        : {
            model:
              row.fallback.model === null
                ? null
                : `${row.fallback.model.provider}/${row.fallback.model.modelId}`,
            tried: row.fallback.tried,
          },
  };
}

function toolCallOf(content: unknown) {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const block = content as { kind?: unknown; call?: unknown };
  if (block.kind !== 'toolcall' || block.call === null || typeof block.call !== 'object')
    return null;
  const call = block.call as { name?: unknown; arguments?: unknown; isError?: unknown };
  return {
    name: typeof call.name === 'string' ? call.name : 'unknown',
    isError: call.isError === true,
    arguments: clip(JSON.stringify(call.arguments ?? null), ARGS_MAX_CHARS),
  };
}

function inspectBuild(db: Db, row: TeamBuild, focusStepId: string | null, env: NodeJS.ProcessEnv) {
  const now = nowMs();
  const steps = withQuota(
    db,
    db
      .select()
      .from(step)
      .where(eq(step.buildId, row.id))
      .orderBy(asc(step.createdAt), asc(step.id))
      .all(),
  );
  const residual = failedStepResidualText(
    db,
    steps.filter((s) => s.status === 'failed').map((s) => s.id),
  ).get(row.id);
  const recorded = row.errorMessage ?? residual ?? null;
  const quotaWait = steps.find((s) => s.status === 'waiting_quota' && s.quotaBlock !== null);
  let cause: BuildOutcome = classifyBuildCause({
    errorMessage: recorded,
    prNumber: row.prNumber,
    ageMs: now - row.createdAt,
  });
  let evidence: Evidence | null =
    recorded === null
      ? null
      : {
          source: row.errorMessage !== null ? 'build error' : 'failed step report',
          at: iso(steps.findLast((s) => s.finishedAt !== null)?.finishedAt ?? null),
          text: clip(recorded),
        };
  if (recorded === null && row.prNumber === null && quotaWait?.quotaBlock) {
    cause = 'quota';
    evidence = {
      source: 'step quota wait',
      at: iso(quotaWait.quotaBlock.lastAt),
      text: clip(quotaWait.quotaBlock.reason),
    };
  } else if (evidence === null) {
    const last = steps.at(-1);
    evidence =
      last === undefined
        ? { source: 'build', at: iso(row.createdAt), text: 'no step was created for this build' }
        : {
            source: 'last step',
            at: iso(last.lastProgressAt ?? last.claimedAt ?? last.createdAt),
            text: `${last.kind} step ${last.status}, claimed ${last.claimCount} time(s)`,
          };
  }
  const recent = db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.conversationId, row.id))
    .orderBy(desc(message.createdAt), desc(sql`rowid`))
    .limit(MESSAGE_SCAN_LIMIT)
    .all();
  const toolCalls: { at: string | null; name: string; isError: boolean; arguments: string }[] = [];
  const events: { at: string | null; text: string }[] = [];
  for (const m of recent) {
    const call = toolCallOf(m.content);
    if (call !== null) {
      if (toolCalls.length < TOOL_CALL_LIMIT) toolCalls.push({ at: iso(m.createdAt), ...call });
      continue;
    }
    if (m.role !== 'system' || events.length >= EVENT_LIMIT) continue;
    const parsed = systemRowOf(m.content);
    if (parsed?.kind === AUTOMATIC_RETRY_ROW_KIND) {
      const count =
        parsed.maxAttempts !== null
          ? `${parsed.attempt}/${parsed.maxAttempts}`
          : parsed.attempt > 0
            ? String(parsed.attempt)
            : 'rate-limit';
      const detail = parsed.priorError ? `: ${parsed.priorError}` : '';
      events.push({
        at: iso(m.createdAt),
        text: clip(`automatic retry (${count}, ${parsed.reasonCode})${detail}`),
      });
      continue;
    }
    if (parsed?.kind === BUILD_FAILURE_ROW_KIND) {
      const reason = parsed.reason.trim();
      if (reason !== '') {
        events.push({ at: iso(m.createdAt), text: clip(`build failure: ${reason}`) });
      }
      continue;
    }
    const text = messageText(m.content).trim();
    if (text === '' || text.startsWith('{')) continue;
    events.push({ at: iso(m.createdAt), text: clip(text) });
  }
  const usage = db
    .select({
      model: tokenUsage.model,
      input: tokenUsage.input,
      output: tokenUsage.output,
      cacheRead: tokenUsage.cacheRead,
      cacheWrite: tokenUsage.cacheWrite,
      costTotal: tokenUsage.costTotal,
    })
    .from(tokenUsage)
    .where(eq(tokenUsage.buildId, row.id))
    .all()
    .filter((u) => u.input + u.output + u.cacheRead + u.cacheWrite > 0);
  const context = db
    .select({
      model: stepUsage.model,
      contextTokens: sql<number | null>`max(${stepUsage.contextTokens})`,
      contextWindow: sql<number | null>`max(${stepUsage.contextWindow})`,
    })
    .from(stepUsage)
    .where(eq(stepUsage.buildId, row.id))
    .groupBy(stepUsage.model)
    .all()
    .filter((c) => c.contextTokens !== null);
  const phaseHistory = db
    .select({
      at: todoTransition.at,
      from: todoTransition.fromPhase,
      to: todoTransition.toPhase,
      cause: todoTransition.cause,
    })
    .from(todoTransition)
    .where(eq(todoTransition.todoId, row.todoId))
    .orderBy(desc(todoTransition.at), desc(sql`rowid`))
    .limit(STEP_LIMIT)
    .all()
    .reverse()
    .map((t) => ({ ...t, at: iso(t.at) }));
  const shownSteps = steps.slice(-STEP_LIMIT);
  const focus = focusStepId === null ? undefined : steps.find((s) => s.id === focusStepId);
  if (focus !== undefined && !shownSteps.includes(focus)) shownSteps.unshift(focus);
  return {
    kind: 'build' as const,
    task: { todoId: row.todoId, seqNum: row.seqNum, title: clip(row.title, 160) },
    build: {
      id: row.id,
      createdAt: iso(row.createdAt),
      prNumber: row.prNumber,
      prUrl: row.prUrl,
      failureCode: row.failureCode,
      failureDetail: redactedDetail(row.failureDetail),
    },
    cause,
    evidence,
    phaseHistory,
    steps: shownSteps.map(stepLine),
    stepsOmitted: steps.length - shownSteps.length,
    recentEvents: events,
    recentToolCalls: toolCalls,
    toolErrors: toolCalls.filter((c) => c.isError).length,
    usage: {
      models: usage,
      costTotal: usage.some((u) => u.costTotal !== null)
        ? usage.reduce((sum, u) => sum + (u.costTotal ?? 0), 0)
        : null,
      context,
    },
    langfuseTraceId: traceExportConfigured(env) ? otlpTraceIdOfBuild(row.id) : null,
  };
}

function turnError(db: Db, stepId: string): string | null {
  const recorded = db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `chief-err-${stepId}`))
    .get();
  if (recorded === undefined) return null;
  try {
    const content =
      typeof recorded.content === 'string' ? JSON.parse(recorded.content) : recorded.content;
    const parsed = chiefTurnErrorContentSchema.safeParse(content);
    return parsed.success ? parsed.data.message : messageText(recorded.content);
  } catch {
    return messageText(recorded.content);
  }
}

function inspectTurns(
  db: Db,
  thread: TeamThread,
  focusStepId: string | null,
  env: NodeJS.ProcessEnv,
) {
  const now = nowMs();
  const exporting = traceExportConfigured(env);
  const turns = withQuota(
    db,
    focusStepId === null
      ? db
          .select()
          .from(step)
          .where(and(eq(step.buildId, thread.id), eq(step.kind, 'chief')))
          .orderBy(desc(step.createdAt), desc(step.id))
          .limit(TURN_LIMIT)
          .all()
      : db.select().from(step).where(eq(step.id, focusStepId)).all(),
  );
  const ids = turns.map((t) => t.id);
  const usageRows =
    ids.length === 0
      ? []
      : db.select().from(chiefTurnUsage).where(inArray(chiefTurnUsage.stepId, ids)).all();
  const snapshots =
    ids.length === 0
      ? []
      : db
          .select({
            turnId: coordinatorTurnSnapshot.turnId,
            status: coordinatorTurnSnapshot.status,
            outcome: coordinatorTurnSnapshot.outcome,
            reason: coordinatorTurnSnapshot.reason,
          })
          .from(coordinatorTurnSnapshot)
          .where(inArray(coordinatorTurnSnapshot.turnId, ids))
          .all();
  const lines = turns.map((t) => {
    const error = t.status === 'failed' ? turnError(db, t.id) : null;
    const cause: BuildOutcome | 'done' =
      t.status === 'done'
        ? 'done'
        : t.status === 'stopped'
          ? 'cancelled'
          : classifyBuildCause({
              errorMessage:
                error ?? (t.status === 'failed' ? 'turn failed without a recorded error' : null),
              prNumber: null,
              ageMs: now - t.createdAt,
            });
    const snapshot = snapshots.find((s) => s.turnId === t.id);
    return {
      ...stepLine(t),
      cause,
      error: error === null ? null : clip(error),
      usage: usageRows
        .filter((u) => u.stepId === t.id)
        .map((u) => ({
          model: u.model,
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          ttftMs: u.ttftMs,
          contextTokens: u.contextTokens,
          contextWindow: u.contextWindow,
          compactAt: u.compactAt,
        })),
      snapshot:
        snapshot === undefined
          ? null
          : {
              status: snapshot.status,
              outcome: snapshot.outcome,
              reason: snapshot.reason,
            },
      langfuseTraceId: exporting ? otlpTraceIdOfTurn(t.id) : null,
    };
  });
  const failed = lines.find((l) => l.status === 'failed');
  return {
    kind: 'coordinator' as const,
    thread: { id: thread.id, title: clip(thread.title, 160) },
    cause: failed?.cause ?? lines[0]?.cause ?? 'active',
    evidence:
      failed === undefined
        ? null
        : {
            source: 'coordinator turn error',
            at: failed.finishedAt,
            text: failed.error ?? 'turn failed without a recorded error',
          },
    turns: lines,
  };
}

function fitOutput<T extends Record<string, unknown>>(result: T): T & { truncated: boolean } {
  const out: Record<string, unknown> = { ...result, truncated: false };
  const bytes = () => Buffer.byteLength(JSON.stringify(out), 'utf8');
  for (const key of ['recentToolCalls', 'recentEvents', 'steps', 'turns']) {
    while (bytes() > INSPECT_RUN_MAX_OUTPUT_BYTES) {
      const list = out[key];
      if (!Array.isArray(list) || list.length <= 1) break;
      out[key] = list.slice(0, -1);
      out.truncated = true;
    }
  }
  return out as T & { truncated: boolean };
}

export function inspectRun(
  db: Db,
  teamId: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const target = resolveRunTarget(db, teamId, id);
  if (target.kind === 'unstarted-task')
    return {
      kind: 'task',
      todoId: target.todoId,
      cause: 'not-started',
      trust: 'untrusted-run-record',
    };
  const result: Record<string, unknown> =
    target.kind === 'thread'
      ? inspectTurns(db, target.thread, null, env)
      : target.kind === 'turn'
        ? inspectTurns(db, target.thread, target.stepId, env)
        : inspectBuild(db, target.build, target.stepId, env);
  const redacted = redactSecrets({ ...result, trust: 'untrusted-run-record' }).value as Record<
    string,
    unknown
  >;
  return fitOutput(redacted);
}
