import {
  CHIEF_NOTICE_KIND,
  classifyStepFailure,
  isProviderAuthFailure,
  RETRY_PARKED_MARK,
  runtimeUpdateRequired,
  UNSTARTED_STEP_STATUSES,
  WORKFLOW_PUSH_REFUSAL,
} from '@cairn/shared';
import { and, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefMessage, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { coordinatorThreadRow, ensureChief } from './chief.js';
import { reconcileOwners } from './owner.js';
import { routeForStep } from './routing-rules.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export { RETRY_PARKED_MARK };
export const FAILED_BUILDS_PER_HOUR_LIMIT = 3;
export const FAILED_BUILD_WINDOW_MS = 3_600_000;
export const AUTOMATIC_RETRY_LIMIT = 3;
export const AUTOMATIC_RETRY_BASE_MS = 60_000;

const GATE_REJECTION = [
  '方案结构不合格',
  '规划未产出方案',
  '信息卡未产出报告',
  '偏离工作分支',
  '构建零改动',
  '转人工处理',
  '死循环闸',
  '请人工复核',
] as const;

const MISSING_CREDENTIALS = [
  'no team secret is available',
  'api key is missing',
  'api key is not configured',
  'gemini login',
  'reconnect github',
  '重新连接 github',
  '未配置模型',
  '尚未上报模型清单',
  '未启用',
] as const;

export function retryIsParked(error: string): boolean {
  if (error.startsWith(RETRY_PARKED_MARK)) return true;
  const kind = classifyStepFailure(error);
  return kind === 'model_unavailable' || kind === 'runtime_outdated';
}

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

function runtimeUpdateReason(
  update: NonNullable<ReturnType<typeof runtimeUpdateRequired>>,
): string {
  const runtime = update.runtime ?? 'the agent runtime';
  const need = `this model needs ${runtime} ${update.required} or newer`;
  return update.current === null
    ? `${RETRY_PARKED_MARK}: ${need}. Update Cairn, then retry.`
    : `${RETRY_PARKED_MARK}: Cairn's built-in ${runtime} ${update.current} is too old: ${need}. Update Cairn, then retry.`;
}

export function failureNeedsHuman(errorMessage: string): boolean {
  if (automaticRestartBlocked(errorMessage)) return true;
  if (errorMessage.startsWith('PR Auto-fix needs you:')) return true;
  if (isProviderAuthFailure(errorMessage)) return true;
  if (GATE_REJECTION.some((mark) => errorMessage.includes(mark))) return true;
  const lower = errorMessage.toLowerCase();
  return MISSING_CREDENTIALS.some((mark) => lower.includes(mark.toLowerCase()));
}

export function automaticRetryDelayMs(retryAttempt: number): number {
  return AUTOMATIC_RETRY_BASE_MS * 2 ** retryAttempt;
}

export function automaticRetryDueAt(phaseAt: number, retryAttempt: number): number {
  return phaseAt + automaticRetryDelayMs(retryAttempt);
}

function lastStepScheduledBuildIds(db: Db, buildIds: string[]): Set<string> {
  if (buildIds.length === 0) return new Set();
  const latestByBuild = new Map<string, { scheduleId: string | null; createdAt: number }>();
  for (const row of db
    .select({ buildId: step.buildId, scheduleId: step.scheduleId, createdAt: step.createdAt })
    .from(step)
    .where(inArray(step.buildId, buildIds))
    .all()) {
    const seen = latestByBuild.get(row.buildId);
    if (seen === undefined || row.createdAt >= seen.createdAt) latestByBuild.set(row.buildId, row);
  }
  return new Set(
    [...latestByBuild].flatMap(([buildId, row]) => (row.scheduleId === null ? [] : [buildId])),
  );
}

export function automaticRetryOwed(
  db: Db,
  buildRow: { id: string; errorMessage: string | null; retryAttempt: number },
): boolean {
  if (buildRow.retryAttempt >= AUTOMATIC_RETRY_LIMIT) return false;
  if (failureNeedsHuman(buildRow.errorMessage ?? '')) return false;
  if (pendingWorkerQuestions(db, buildRow.id).length > 0) return false;
  return !lastStepScheduledBuildIds(db, [buildRow.id]).has(buildRow.id);
}

export function assertAutomaticRetryAllowed(deps: BuildDeps, todoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!row?.latestBuildId) return;
  if (row.phase === 'failed') parkFailedBuild(deps, row.latestBuildId);
  const latest = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  assertPermanentRefusalCleared(latest?.errorMessage ?? null);
  if (latest && retryIsParked(latest.errorMessage ?? '')) {
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
        eq(step.status, 'failed'),
        isNotNull(build.errorMessage),
        gt(sql`coalesce(${step.finishedAt}, ${build.createdAt})`, now - FAILED_BUILD_WINDOW_MS),
        lte(sql`coalesce(${step.finishedAt}, ${build.createdAt})`, now),
      ),
    )
    .all().length;
  const error = row.errorMessage ?? '';
  const modelUnavailable = classifyStepFailure(error) === 'model_unavailable';
  const retriesExhausted = row.retryAttempt >= AUTOMATIC_RETRY_LIMIT;
  if (!retryIsParked(error) && !retriesExhausted && failures <= FAILED_BUILDS_PER_HOUR_LIMIT)
    return false;
  const namedModel = /\bmodel\s+[^a-z0-9]*([a-z0-9][a-z0-9./:_-]*)/i.exec(error)?.[1];
  const rejectedModel =
    (namedModel && !['not', 'unavailable', 'unsupported', 'is'].includes(namedModel.toLowerCase())
      ? namedModel
      : null) ??
    /(?:model_not_found|unsupported[ _-]model)\s*:\s*([\w./:-]+)/i.exec(error)?.[1] ??
    routeForStep(deps.db, owner, 'session')?.modelId ??
    'unknown';
  const runtimeUpdate = runtimeUpdateRequired(error);
  const reason = error.startsWith(RETRY_PARKED_MARK)
    ? error
    : runtimeUpdate !== null
      ? `${runtimeUpdateReason(runtimeUpdate)}\n${error}`
      : modelUnavailable
        ? `${RETRY_PARKED_MARK}: model unavailable (${rejectedModel}). Update model routing before retrying.`
        : retriesExhausted
          ? `${RETRY_PARKED_MARK}: automatic retries exhausted (${AUTOMATIC_RETRY_LIMIT}). Last error: ${error}`
          : `${RETRY_PARKED_MARK}: ${failures} failed builds in one hour (limit ${FAILED_BUILDS_PER_HOUR_LIMIT}). Last error: ${error}`;
  const noticeReason =
    runtimeUpdate !== null
      ? runtimeUpdateReason(runtimeUpdate)
      : reason.replace(/\. Last error: [\s\S]*$/, '. Open the task to see the error.');
  const id = `retry-parked-${buildId}`;
  const taskNotice = {
    id,
    role: 'system' as const,
    content: modelUnavailable ? error : reason,
    createdAt: now,
  };
  const parked = deps.db.transaction(() => {
    deps.db.update(build).set({ errorMessage: reason }).where(eq(build.id, buildId)).run();
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
    deps.hub.publishBuildDoc(owner.teamId, { ...row, errorMessage: reason });
    deps.convHub?.publishMessage(parked.threadId, parked.notice);
  }
  reconcileOwners(deps, [owner.id]);
  return true;
}
