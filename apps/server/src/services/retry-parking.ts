import {
  type BuildRecord,
  CHIEF_NOTICE_KIND,
  classifyRetryFailure,
  RETRY_AFTER_MAX_MS,
  RETRY_AFTER_MIN_MS,
  RETRY_PARKED_MARK,
  type RetryFailureClass,
  type RetryReasonCode,
  runtimeUpdateRequired,
  UNSTARTED_STEP_STATUSES,
  WORKFLOW_PUSH_REFUSAL,
} from '@cairn/shared';
import { and, eq, gt, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefMessage, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { coordinatorThreadRow, ensureChief } from './chief.js';
import { reconcileOwners } from './owner.js';
import {
  automaticRetryOwed,
  budgetExhaustedReason,
  ERROR_SCAN_LIMIT,
  FAILED_BUILD_WINDOW_MS,
  FAILED_BUILDS_PER_HOUR_LIMIT,
  jitteredRetryDelayMs,
  nominalDelayForClass,
  resolvedClassFor,
  retryIsParked,
  runtimeUpdateReason,
  sanitizeDetail,
  UNKNOWN_RETRY_LIMIT,
} from './retry-policy.js';
import { routeForStep } from './routing-rules.js';

export {
  AUTOMATIC_RETRY_BASE_MS,
  AUTOMATIC_RETRY_LIMIT,
  automaticRetryDelayMs,
  automaticRetryDueAt,
  automaticRetryOwed,
  FAILED_BUILD_WINDOW_MS,
  FAILED_BUILDS_PER_HOUR_LIMIT,
  failureNeedsHuman,
  jitteredRetryDelayMs,
  RATE_LIMIT_RETRY_BASE_MS,
  RATE_LIMIT_RETRY_CAP_MS,
  RATE_LIMIT_RETRY_MAX_ATTEMPTS,
  RATE_LIMIT_RETRY_WINDOW_MS,
  RETRY_PARKED_MARK,
  type RetryBuildSlice,
  retryIsParked,
  TRANSIENT_RETRY_BASE_MS,
  TRANSIENT_RETRY_CAP_MS,
  TRANSIENT_RETRY_MAX_ATTEMPTS,
  TRANSIENT_RETRY_WINDOW_MS,
  todoRetryStateOf,
  UNKNOWN_RETRY_BASE_MS,
  UNKNOWN_RETRY_CAP_MS,
  UNKNOWN_RETRY_LIMIT,
  UNKNOWN_RETRY_WINDOW_MS,
} from './retry-policy.js';

function workflowPushRefused(error: string): boolean {
  return (
    error === WORKFLOW_PUSH_REFUSAL ||
    (error.startsWith(RETRY_PARKED_MARK) && error.endsWith(`Last error: ${WORKFLOW_PUSH_REFUSAL}`))
  );
}

export function automaticRestartBlocked(error: string): boolean {
  return workflowPushRefused(error) || retryIsParked(error);
}

export function assertPermanentRefusalCleared(error: string | null): void {
  if (error !== null && workflowPushRefused(error)) throw new HttpError(409, WORKFLOW_PUSH_REFUSAL);
}

export function assertAutomaticRetryAllowed(deps: BuildDeps, todoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!row?.latestBuildId) return;
  if (row.phase === 'failed') parkFailedBuild(deps, row.latestBuildId);
  const latest = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  assertPermanentRefusalCleared(latest?.errorMessage ?? null);
  if (latest && (latest.retryParkReason != null || retryIsParked(latest.errorMessage ?? ''))) {
    const update = runtimeUpdateRequired(latest.errorMessage ?? '');
    throw new HttpError(
      409,
      update !== null
        ? runtimeUpdateReason(update)
        : latest.errorMessage?.startsWith(RETRY_PARKED_MARK)
          ? latest.errorMessage
          : `${RETRY_PARKED_MARK}: ${latest.errorMessage}`,
    );
  }
}

function rejectedModelOf(db: Db, owner: typeof todo.$inferSelect, error: string): string {
  const slice = error.length <= ERROR_SCAN_LIMIT ? error : error.slice(0, ERROR_SCAN_LIMIT);
  const namedModel = /\bmodel\s+[^a-z0-9\r\n]{0,8}([a-z0-9][a-z0-9./:_-]{0,80})/i.exec(slice)?.[1];
  const candidate =
    (namedModel && !['not', 'unavailable', 'unsupported', 'is'].includes(namedModel.toLowerCase())
      ? namedModel
      : null) ??
    /(?:model_not_found|unsupported[ _-]model)\s*:\s*([\w./:-]{1,80})/i.exec(slice)?.[1] ??
    routeForStep(db, owner, 'session')?.modelId ??
    'unknown';
  return sanitizeDetail(candidate) ?? 'unknown';
}

function formatChiefParkNotice(input: {
  reasonCode: RetryReasonCode;
  runtimeUpdate: ReturnType<typeof runtimeUpdateRequired>;
  rejectedModel: string | null;
  retryAttempt: number;
  failures: number;
}): string {
  const { reasonCode, runtimeUpdate, rejectedModel, retryAttempt, failures } = input;
  if (runtimeUpdate !== null) return runtimeUpdateReason(runtimeUpdate);
  if (reasonCode === 'model_unavailable') {
    return `${RETRY_PARKED_MARK}: model unavailable (${sanitizeDetail(rejectedModel) ?? 'unknown'}). Update model routing before retrying.`;
  }
  if (reasonCode === 'setup_hook') {
    return `${RETRY_PARKED_MARK}: setup hook failed. Fix the workspace setup hook or environment, then retry. Open the task to see the error.`;
  }
  if (reasonCode === 'missing_tool') {
    return `${RETRY_PARKED_MARK}: required tool not found. Install the missing tool on the Runner, then retry. Open the task to see the error.`;
  }
  if (reasonCode === 'auth') {
    return `${RETRY_PARKED_MARK}: authentication failed. Check credentials or reconnect the provider, then retry. Open the task to see the error.`;
  }
  if (reasonCode === 'spend_limit') {
    return `${RETRY_PARKED_MARK}: provider spend limit reached. Raise the budget or switch providers, then retry. Open the task to see the error.`;
  }
  if (reasonCode === 'config') {
    return `${RETRY_PARKED_MARK}: configuration or request error. Fix the task or provider configuration, then retry. Open the task to see the error.`;
  }
  if (reasonCode === 'gate_rejection') {
    return `${RETRY_PARKED_MARK}: stopped at a verification gate. Review the feedback before retrying. Open the task to see the error.`;
  }
  if (reasonCode === 'branch_divergence') {
    return `${RETRY_PARKED_MARK}: remote branch diverged. Reconcile the branch before retrying. Open the task to see the error.`;
  }
  if (reasonCode === 'window_exhausted') {
    return `${RETRY_PARKED_MARK}: transient retry window exhausted (6h, ${retryAttempt} retries). Open the task to see the error.`;
  }
  if (reasonCode === 'rate_limit_exhausted') {
    return `${RETRY_PARKED_MARK}: rate limit wait exhausted (24h). Open the task to see the error.`;
  }
  if (reasonCode === 'retries_exhausted') {
    return `${RETRY_PARKED_MARK}: automatic retries exhausted (${UNKNOWN_RETRY_LIMIT}). Open the task to see the error.`;
  }
  if (reasonCode === 'breaker') {
    return `${RETRY_PARKED_MARK}: ${failures} failed builds in one hour (limit ${FAILED_BUILDS_PER_HOUR_LIMIT}). Open the task to see the error.`;
  }
  return `${RETRY_PARKED_MARK}: automatic retries stopped. Open the task to see the error.`;
}

function formatParkedMessage(input: {
  error: string;
  reasonCode: RetryReasonCode;
  runtimeUpdate: ReturnType<typeof runtimeUpdateRequired>;
  rejectedModel: string | null;
  retryAttempt: number;
  failures: number;
}): string {
  const { error, reasonCode, runtimeUpdate, rejectedModel, retryAttempt, failures } = input;
  if (error.startsWith(RETRY_PARKED_MARK)) return error;
  if (runtimeUpdate !== null) return `${runtimeUpdateReason(runtimeUpdate)}\n${error}`;
  if (reasonCode === 'model_unavailable') {
    return `${RETRY_PARKED_MARK}: model unavailable (${rejectedModel ?? 'unknown'}). Update model routing before retrying.`;
  }
  if (reasonCode === 'setup_hook') {
    return `${RETRY_PARKED_MARK}: setup hook failed. Fix the workspace setup hook or environment, then retry. Last error: ${error}`;
  }
  if (reasonCode === 'missing_tool') {
    return `${RETRY_PARKED_MARK}: required tool not found. Install the missing tool on the Runner, then retry. Last error: ${error}`;
  }
  if (reasonCode === 'auth') {
    return `${RETRY_PARKED_MARK}: authentication failed. Check credentials or reconnect the provider, then retry. Last error: ${error}`;
  }
  if (reasonCode === 'spend_limit') {
    return `${RETRY_PARKED_MARK}: provider spend limit reached. Raise the budget or switch providers, then retry. Last error: ${error}`;
  }
  if (reasonCode === 'config') {
    return `${RETRY_PARKED_MARK}: configuration or request error. Fix the task or provider configuration, then retry. Last error: ${error}`;
  }
  if (reasonCode === 'gate_rejection') {
    return error;
  }
  if (reasonCode === 'window_exhausted') {
    return `${RETRY_PARKED_MARK}: transient retry window exhausted (6h, ${retryAttempt} retries). Last error: ${error}`;
  }
  if (reasonCode === 'rate_limit_exhausted') {
    return `${RETRY_PARKED_MARK}: rate limit wait exhausted (24h). Last error: ${error}`;
  }
  if (reasonCode === 'retries_exhausted') {
    return `${RETRY_PARKED_MARK}: automatic retries exhausted (${UNKNOWN_RETRY_LIMIT}). Last error: ${error}`;
  }
  return `${RETRY_PARKED_MARK}: ${failures} failed builds in one hour (limit ${FAILED_BUILDS_PER_HOUR_LIMIT}). Last error: ${error}`;
}

export function parkFailedBuild(deps: BuildDeps, buildId: string, now = nowMs()): boolean {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row || workflowPushRefused(row.errorMessage ?? '')) return false;
  const owner = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!owner || owner.latestBuildId !== buildId || owner.archivedAt !== null) return false;
  const failures = deps.db
    .selectDistinct({ id: build.id })
    .from(build)
    .innerJoin(step, eq(step.buildId, build.id))
    .where(
      and(
        eq(build.todoId, owner.id),
        ne(build.triggerSource, 'retry'),
        eq(step.status, 'failed'),
        isNotNull(build.errorMessage),
        gt(sql`coalesce(${step.finishedAt}, ${build.createdAt})`, now - FAILED_BUILD_WINDOW_MS),
        lte(sql`coalesce(${step.finishedAt}, ${build.createdAt})`, now),
      ),
    )
    .all().length;
  const error = row.errorMessage ?? '';
  const { failureClass, classified } = resolvedClassFor(row, now);
  const exhausted = budgetExhaustedReason(deps.db, row, now);
  const permanentParked = retryIsParked(error);
  const breakerTripped = failures > FAILED_BUILDS_PER_HOUR_LIMIT;
  if (!permanentParked && exhausted === null && !breakerTripped) return false;

  const reasonCode: RetryReasonCode = permanentParked
    ? classified.reasonCode
    : exhausted !== null
      ? exhausted
      : 'breaker';
  const parkedClass: RetryFailureClass = permanentParked ? 'permanent' : failureClass;
  const modelUnavailable = reasonCode === 'model_unavailable';
  const rejectedModel = modelUnavailable ? rejectedModelOf(deps.db, owner, error) : null;
  const runtimeUpdate = runtimeUpdateRequired(error);
  const reason = formatParkedMessage({
    error,
    reasonCode,
    runtimeUpdate,
    rejectedModel,
    retryAttempt: row.retryAttempt,
    failures,
  });
  const noticeReason = formatChiefParkNotice({
    reasonCode,
    runtimeUpdate,
    rejectedModel,
    retryAttempt: row.retryAttempt,
    failures,
  });
  const baseId = `retry-parked-${buildId}`;
  const priorBase =
    row.retryParkReason === null
      ? deps.db.select({ id: message.id }).from(message).where(eq(message.id, baseId)).get()
      : undefined;
  const id = priorBase === undefined ? baseId : `${baseId}-${owner.phaseAt}`;
  const taskNotice = {
    id,
    role: 'system' as const,
    content: modelUnavailable ? error : reason,
    createdAt: now,
  };
  const parked = deps.db.transaction(() => {
    deps.db
      .update(build)
      .set({
        errorMessage: reason,
        retryClass: parkedClass,
        retryNextAt: null,
        retryParkReason: reasonCode,
      })
      .where(eq(build.id, buildId))
      .run();
    deps.db
      .update(step)
      .set({ status: 'stopped', finishedAt: now })
      .where(and(eq(step.buildId, buildId), inArray(step.status, [...UNSTARTED_STEP_STATUSES])))
      .run();
    const inserted = deps.db
      .insert(message)
      .values({ ...taskNotice, conversationId: buildId })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return null;
    const thread = coordinatorThreadRow(deps, ensureChief(deps, owner.teamId));
    const notice = {
      id: `${id}-${thread.id}`,
      role: 'system' as const,
      content: JSON.stringify({
        kind: CHIEF_NOTICE_KIND,
        message: `Task #${owner.seqNum} (${owner.title}): ${noticeReason}`,
        provenance: `retry-parking:${owner.id}`,
        ...(runtimeUpdate !== null
          ? { runtimeUpdate: { task: owner.title, ...runtimeUpdate } }
          : {}),
      }),
      projectId: owner.projectId,
      createdAt: now,
    };
    deps.db
      .insert(chiefMessage)
      .values({ ...notice, threadId: thread.id })
      .onConflictDoNothing()
      .run();
    return { threadId: thread.id, notice };
  });
  if (parked !== null) {
    deps.convHub?.publishMessage(buildId, taskNotice);
    const buildRecord: BuildRecord = {
      id: row.id,
      todoId: row.todoId,
      withPlan: row.withPlan,
      prevPhase: row.prevPhase ?? null,
      triggerSource: row.triggerSource,
      planDocId: row.planDocId,
      errorMessage: reason,
      prUrl: row.prUrl,
      prNumber: row.prNumber,
      diffHash: row.diffHash,
      reportAttachmentId: row.reportAttachmentId,
      stop: row.stop,
      createdAt: row.createdAt,
    };
    deps.hub.publishBuildDoc(owner.teamId, buildRecord);
    deps.convHub?.publishMessage(parked.threadId, parked.notice);
  }
  reconcileOwners(deps, [owner.id]);
  return true;
}

export function scheduleOrParkFailedBuild(
  deps: BuildDeps,
  buildId: string,
  now = nowMs(),
  random: () => number = Math.random,
): { parked: boolean; nextRetryAt: number | null } {
  if (parkFailedBuild(deps, buildId, now)) return { parked: true, nextRetryAt: null };
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) return { parked: false, nextRetryAt: null };
  const owner = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!owner || owner.latestBuildId !== buildId || owner.archivedAt !== null) {
    return { parked: false, nextRetryAt: null };
  }
  const classified = classifyRetryFailure(row.errorMessage ?? '', now);
  if (classified.failureClass === 'permanent') {
    deps.db
      .update(build)
      .set({
        retryClass: 'permanent',
        retryNextAt: null,
        retryParkReason: classified.reasonCode,
      })
      .where(eq(build.id, buildId))
      .run();
    return { parked: true, nextRetryAt: null };
  }
  if (!automaticRetryOwed(deps.db, row, now)) {
    deps.db
      .update(build)
      .set({ retryClass: classified.failureClass, retryNextAt: null })
      .where(eq(build.id, buildId))
      .run();
    return { parked: false, nextRetryAt: null };
  }
  const windowStartedAt = row.retryWindowStartedAt ?? now;
  const nextRetryAt =
    classified.failureClass === 'rate_limit'
      ? classified.resetAt !== null
        ? Math.max(now + RETRY_AFTER_MIN_MS, Math.min(classified.resetAt, now + RETRY_AFTER_MAX_MS))
        : classified.retryAfterMs !== null
          ? now +
            Math.max(RETRY_AFTER_MIN_MS, Math.min(classified.retryAfterMs, RETRY_AFTER_MAX_MS))
          : now +
            jitteredRetryDelayMs(nominalDelayForClass('rate_limit', row.retryAttempt), 0.1, random)
      : now +
        jitteredRetryDelayMs(
          nominalDelayForClass(classified.failureClass, row.retryAttempt),
          0.2,
          random,
        );
  deps.db
    .update(build)
    .set({
      retryClass: classified.failureClass,
      retryNextAt: nextRetryAt,
      retryWindowStartedAt: windowStartedAt,
      retryParkReason: null,
    })
    .where(eq(build.id, buildId))
    .run();
  return { parked: false, nextRetryAt };
}
