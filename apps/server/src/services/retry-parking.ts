import { CHIEF_NOTICE_KIND, classifyStepFailure, UNSTARTED_STEP_STATUSES } from '@cairn/shared';
import { and, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { build, chiefMessage, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { coordinatorThreadRow, ensureChief } from './chief.js';
import { reconcileOwners } from './owner.js';
import { routeForStep } from './routing-rules.js';

export const RETRY_PARKED_MARK = 'Task parked';
export const FAILED_BUILDS_PER_HOUR_LIMIT = 3;
export const FAILED_BUILD_WINDOW_MS = 3_600_000;

export function retryIsParked(error: string): boolean {
  return error.startsWith(RETRY_PARKED_MARK) || classifyStepFailure(error) === 'model_unavailable';
}

export function assertAutomaticRetryAllowed(deps: BuildDeps, todoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!row?.latestBuildId) return;
  if (row.phase === 'failed') parkFailedBuild(deps, row.latestBuildId);
  const latest = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  if (latest && retryIsParked(latest.errorMessage ?? '')) {
    throw new HttpError(
      409,
      latest.errorMessage?.startsWith(RETRY_PARKED_MARK)
        ? latest.errorMessage
        : `${RETRY_PARKED_MARK}: ${latest.errorMessage}`,
    );
  }
}

export function parkFailedBuild(deps: BuildDeps, buildId: string, now = nowMs()): boolean {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) return false;
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
  if (!retryIsParked(error) && failures <= FAILED_BUILDS_PER_HOUR_LIMIT) return false;
  const namedModel = /\bmodel\s+[^a-z0-9]*([a-z0-9][a-z0-9./:_-]*)/i.exec(error)?.[1];
  const rejectedModel =
    (namedModel && !['not', 'unavailable', 'unsupported', 'is'].includes(namedModel.toLowerCase())
      ? namedModel
      : null) ??
    /(?:model_not_found|unsupported[ _-]model)\s*:\s*([\w./:-]+)/i.exec(error)?.[1] ??
    routeForStep(deps.db, owner, 'session')?.modelId ??
    'unknown';
  const reason = error.startsWith(RETRY_PARKED_MARK)
    ? error
    : modelUnavailable
      ? `${RETRY_PARKED_MARK}: model unavailable (${rejectedModel}). Update model routing before retrying.`
      : `${RETRY_PARKED_MARK}: ${failures} failed builds in one hour (limit ${FAILED_BUILDS_PER_HOUR_LIMIT}). Last error: ${error}`;
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
        message: `Task #${owner.seqNum} (${owner.title}): ${reason}`,
        provenance: `retry-parking:${owner.id}`,
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
