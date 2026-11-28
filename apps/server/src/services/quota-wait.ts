import {
  type QuotaBlock,
  type QuotaWait,
  RETRY_AFTER_MAX_MS,
  type UserRecord,
} from '@cairn/shared';
import { and, eq, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, type QuotaWaitRow, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { holdBlockedBuild } from './blockers.js';
import { claimClientMessage } from './client-message.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyQuotaWait } from './notifications.js';
import type { VapidKeys } from './push.js';
import { readQuota, writeQuota } from './step-groups/quota.js';
import { readSkillInjection } from './step-groups/skill-injection.js';
import { getTodo } from './todos.js';

export interface QuotaWaitDeps {
  db: Db;
  hub: TeamStreamHub;
  convHub?: ConversationStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
}

export const QUOTA_PROBE_BASE_MS = 60_000;

export const QUOTA_PROBE_MAX_MS = 30 * 60_000;

type StepRow = typeof step.$inferSelect;

export function toQuotaWait(row: QuotaWaitRow): QuotaWait {
  return {
    kind: row.kind,
    providerId: row.providerId,
    label: row.label,
    retryAfterMs: row.retryAfterMs,
    probeAt: row.probeAt,
  };
}

function probeWindowMs(retryAfterMs: number | null | undefined, attempts: number): number {
  const backoff = Math.min(QUOTA_PROBE_BASE_MS * 2 ** (attempts - 1), QUOTA_PROBE_MAX_MS);
  if (retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    const bounded = Math.min(retryAfterMs, RETRY_AFTER_MAX_MS);
    return attempts > 1 ? Math.max(bounded, backoff) : bounded;
  }
  return backoff;
}

export function publishStepRow(deps: Pick<QuotaWaitDeps, 'db' | 'convHub'>, row: StepRow): void {
  if (!deps.convHub) return;
  const { quotaBlock } = readQuota(deps.db, row.id);
  const { skillInjection } = readSkillInjection(deps.db, row.id);
  deps.convHub.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection,
    ...(row.status === 'waiting_quota' && quotaBlock !== null
      ? { quotaWait: toQuotaWait(quotaBlock) }
      : {}),
  });
}

export function applyQuotaWaitStep(deps: QuotaWaitDeps, stepRow: StepRow, block: QuotaBlock): void {
  const now = nowMs();
  const result = deps.db.transaction((tx) => {
    const prev = readQuota(tx, stepRow.id).quotaBlock;
    const sameLane = prev !== null && prev.providerId === block.providerId;
    const attempts = sameLane ? prev.attempts + 1 : 1;
    const row: QuotaWaitRow = {
      kind: block.kind,
      providerId: block.providerId,
      label: block.label ?? null,
      reason: block.reason,
      retryAfterMs: block.retryAfterMs ?? null,
      firstSeenAt: sameLane ? prev.firstSeenAt : now,
      lastAt: now,
      attempts,
      probeAt: now + probeWindowMs(block.retryAfterMs, attempts),
    };
    const winner = tx
      .update(step)
      .set({ status: 'waiting_quota' })
      .where(eq(step.id, stepRow.id))
      .returning()
      .get();
    if (!winner) return undefined;
    writeQuota(tx, winner.id, { quotaBlock: row });
    return { winner, row, attempts };
  });
  if (!result) return;
  const { winner, row, attempts } = result;
  publishStepRow(deps, winner);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (buildRow !== undefined) {
    const record = getTodo(deps, buildRow.todoId);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (attempts === 1 && buildRow !== undefined) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow) notifyQuotaWait(deps, todoRow, row);
  }
}

function teamOfStep(db: Db, row: StepRow): string | null {
  const buildRow = db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (buildRow !== undefined) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    return todoRow?.teamId ?? null;
  }
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
  return thread?.teamId ?? null;
}

export function sweepQuotaWaitSteps(deps: QuotaWaitDeps, now: number = nowMs()): number {
  const rows = deps.db.select().from(step).where(eq(step.status, 'waiting_quota')).all();
  let released = 0;
  for (const row of rows) {
    const quota = readQuota(deps.db, row.id);
    if (quota.quotaBlock?.source === 'subscription_policy') continue;
    if ((quota.quotaBlock?.probeAt ?? 0) > now) continue;
    const task = deps.db
      .select({ sourceKind: todo.sourceKind })
      .from(build)
      .innerJoin(todo, eq(todo.id, build.todoId))
      .where(eq(build.id, row.buildId))
      .get();
    if (task?.sourceKind === 'research-intake' || task?.sourceKind === 'research-citation-check')
      continue;
    const keepFallbackModel = row.sessionId !== null || row.checkpointCommit !== null;
    const resetFallback =
      quota.fallback === null
        ? null
        : {
            model: keepFallbackModel ? quota.fallback.model : null,
            tried: [],
            zeroUsageRetried: quota.fallback.zeroUsageRetried,
          };
    const fresh = deps.db.transaction((tx) => {
      const winner = tx
        .update(step)
        .set({ status: 'pending', machineId: null, mcpGrant: null })
        .where(eq(step.id, row.id))
        .returning()
        .get();
      if (winner) writeQuota(tx, winner.id, { fallback: resetFallback });
      return winner;
    });
    if (!fresh) continue;
    released += 1;
    const teamId = teamOfStep(deps.db, row);
    if (teamId !== null) deps.machineHub?.wake(teamId);
    publishStepRow(deps, fresh);
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (buildRow !== undefined) {
      const record = getTodo(deps, buildRow.todoId);
      if (record) deps.hub.publishTodoDoc(record.teamId, record);
    }
  }
  return released;
}

export function retryQuotaWaitNow(
  deps: QuotaWaitDeps,
  buildId: string,
  clientMessageId?: string,
): boolean {
  const releasedIds = deps.db.transaction((tx) => {
    const held = tx
      .select({
        id: step.id,
        sessionId: step.sessionId,
        checkpointCommit: step.checkpointCommit,
      })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          or(
            eq(step.status, 'waiting_quota'),
            and(eq(step.status, 'pending'), eq(step.holdReason, 'quota')),
          ),
        ),
      )
      .all();
    if (held.length === 0) return [];
    claimClientMessage(deps.db, buildId, clientMessageId, {
      delegated: true,
      mode: 'quota_resumed',
    });
    const updated: string[] = [];
    for (const row of held) {
      const { fallback } = readQuota(tx, row.id);
      const keepFallbackModel = row.sessionId !== null || row.checkpointCommit !== null;
      const resetFallback =
        fallback === null
          ? null
          : {
              model: keepFallbackModel ? fallback.model : null,
              tried: [],
              zeroUsageRetried: fallback.zeroUsageRetried,
            };
      const res = tx
        .update(step)
        .set({
          status: 'pending',
          holdReason: null,
          holdUntil: null,
          machineId: null,
          mcpGrant: null,
        })
        .where(
          and(
            eq(step.id, row.id),
            or(
              eq(step.status, 'waiting_quota'),
              and(eq(step.status, 'pending'), eq(step.holdReason, 'quota')),
            ),
          ),
        )
        .run();
      if (res.changes > 0) {
        writeQuota(tx, row.id, { quotaBlock: null, fallback: resetFallback });
        updated.push(row.id);
      }
    }
    if (updated.length > 0) holdBlockedBuild(deps.db, buildId);
    return updated;
  });
  if (releasedIds.length === 0) return false;
  let teamId: string | null = null;
  let wakeable = false;
  for (const id of releasedIds) {
    const fresh = deps.db.select().from(step).where(eq(step.id, id)).get();
    if (fresh === undefined) continue;
    publishStepRow(deps, fresh);
    if (fresh.status === 'pending' && fresh.holdReason === null) wakeable = true;
    if (teamId === null) teamId = teamOfStep(deps.db, fresh);
  }
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow !== undefined) {
    const record = getTodo(deps, buildRow.todoId);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (wakeable && teamId !== null) deps.machineHub?.wake(teamId);
  return true;
}
