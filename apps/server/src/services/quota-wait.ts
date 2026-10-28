import type { QuotaBlock, QuotaWait, UserRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, type QuotaWaitRow, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyQuotaWait } from './notifications.js';
import type { VapidKeys } from './push.js';
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

function probeWindowMs(base: number, attempts: number): number {
  return Math.min(base * 2 ** (attempts - 1), QUOTA_PROBE_MAX_MS);
}

export function publishStepRow(deps: Pick<QuotaWaitDeps, 'convHub'>, row: StepRow): void {
  deps.convHub?.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection: row.skillInjection ?? null,
    ...(row.status === 'waiting_quota' && row.quotaBlock !== null
      ? { quotaWait: toQuotaWait(row.quotaBlock) }
      : {}),
  });
}

export function applyQuotaWaitStep(deps: QuotaWaitDeps, stepRow: StepRow, block: QuotaBlock): void {
  const now = nowMs();
  const prev = stepRow.quotaBlock;
  const sameLane = prev !== null && prev.providerId === block.providerId;
  const attempts = sameLane ? prev.attempts + 1 : 1;
  const base = block.retryAfterMs ?? QUOTA_PROBE_BASE_MS;
  const row: QuotaWaitRow = {
    kind: block.kind,
    providerId: block.providerId,
    label: block.label ?? null,
    reason: block.reason,
    retryAfterMs: block.retryAfterMs ?? null,
    firstSeenAt: sameLane ? prev.firstSeenAt : now,
    lastAt: now,
    attempts,
    probeAt: now + probeWindowMs(base, attempts),
  };
  deps.db
    .update(step)
    .set({ status: 'waiting_quota', quotaBlock: row })
    .where(eq(step.id, stepRow.id))
    .run();
  const fresh = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (fresh !== undefined) publishStepRow(deps, fresh);
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
    if ((row.quotaBlock?.probeAt ?? 0) > now) continue;
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null })
      .where(eq(step.id, row.id))
      .run();
    released += 1;
    const teamId = teamOfStep(deps.db, row);
    if (teamId !== null) deps.machineHub?.wake(teamId);
    const fresh = deps.db.select().from(step).where(eq(step.id, row.id)).get();
    if (fresh !== undefined) publishStepRow(deps, fresh);
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (buildRow !== undefined) {
      const record = getTodo(deps, buildRow.todoId);
      if (record) deps.hub.publishTodoDoc(record.teamId, record);
    }
  }
  return released;
}
