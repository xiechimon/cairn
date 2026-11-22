import {
  ASK_USER_QUESTION_KIND,
  isEndedPhase,
  isInfoOutput,
  type NeedsYouReason,
  type TodoOwner,
  type TodoSection,
  UNSTARTED_STEP_STATUSES,
} from '@cairn/shared';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
  TransactionRollbackError,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, dueEvent, message, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { BLOCKED_BY_HOLD, deadEndBlocker } from './blockers.js';
import { planAwaitsAutoConfirm } from './builds.js';
import {
  type ChiefDeps,
  enqueueOwnershipWake,
  parseChiefTrigger,
  watchProvenance,
} from './chief.js';
import { settleChiefActiveRun } from './chief-turns.js';
import { failureAwaitsAutomaticRetry } from './needs-you.js';
import { notifyOwnership } from './notifications.js';
import { pushToUserSafely, type VapidKeys } from './push.js';
import { publishStepRow } from './quota-wait.js';
import { getTodo } from './todos.js';
import { reportProvenance, turnProvenance } from './turn-provenance.js';

type TodoRow = typeof todo.$inferSelect;
type StepRow = typeof step.$inferSelect;

export type CoordinatorReason = 'question' | 'failed' | 'review' | 'blocked';

export type Ownership =
  | { owner: 'owner'; reason: Exclude<NeedsYouReason, 'handoff'>; workKey: string }
  | { owner: 'owner'; reason: 'handoff'; from: CoordinatorReason; workKey: string }
  | { owner: 'coordinator'; reason: CoordinatorReason; workKey: string };

export const COORDINATOR_TURN_DEADLINE_MS = 30 * 60 * 1000;

export const OWNERSHIP_HANDOFF_KIND = 'ownership-handoff';

export function ownershipHandoffEventId(stepId: string): string {
  return `ownership-handoff:${stepId}`;
}

const ENDED_STEP = new Set(['done', 'failed', 'stopped']);

export interface OwnerDeps extends ChiefDeps {
  vapidKeys?: VapidKeys | null;
}

const NOBODY = 'none';

const PENDING_QUESTION: SQL = sql`json_extract(${message.content}, '$.kind') = ${ASK_USER_QUESTION_KIND} and json_extract(${message.content}, '$.status') = 'pending'`;

export const OWNED_CANDIDATE: SQL = and(
  isNull(todo.archivedAt),
  or(
    inArray(todo.phase, ['confirm', 'needs_input', 'review', 'failed']),
    sql`exists (select 1 from ${message} where ${message.conversationId} = ${todo.latestBuildId} and ${PENDING_QUESTION})`,
    sql`exists (select 1 from ${step} where ${step.buildId} = ${todo.latestBuildId} and ${step.holdReason} = ${BLOCKED_BY_HOLD})`,
  ),
) as SQL;

function pendingQuestionIds(db: Db, buildId: string): string[] {
  return db
    .select({ id: message.id })
    .from(message)
    .where(and(eq(message.conversationId, buildId), PENDING_QUESTION))
    .all()
    .map((row) => row.id)
    .sort();
}

function phaseWork(row: TodoRow): string {
  return `${row.latestBuildId ?? ''}:${row.phaseAt}`;
}

function reviewOwnership(row: TodoRow): Ownership {
  const workKey = `review:${phaseWork(row)}`;
  return { owner: isInfoOutput(row.output) ? 'coordinator' : 'owner', reason: 'review', workKey };
}

function failedOwnership(db: Db, row: TodoRow): Ownership | null {
  if (row.latestBuildId === null) return null;
  const buildRow = db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  if (buildRow === undefined || failureAwaitsAutomaticRetry(db, buildRow)) return null;
  return { owner: 'coordinator', reason: 'failed', workKey: `failed:${phaseWork(row)}` };
}

export function heldByBlockers(db: Db, row: Pick<TodoRow, 'latestBuildId'>): boolean {
  if (row.latestBuildId === null) return false;
  return (
    db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, row.latestBuildId), eq(step.holdReason, BLOCKED_BY_HOLD)))
      .get() !== undefined
  );
}

function blockedOwnership(db: Db, row: TodoRow): Ownership | null {
  if (!heldByBlockers(db, row)) return null;
  const blocker = deadEndBlocker(db, row);
  if (blocker === null) return null;
  return {
    owner: 'coordinator',
    reason: 'blocked',
    workKey: `blocked:${blocker.id}:${blocker.phase}`,
  };
}

type TurnState = 'running' | 'ended' | 'never-started';

const OWNERSHIP_WAKE_TRIGGERS: Record<CoordinatorReason, string> = {
  question: 'wake',
  blocked: 'wake',
  failed: 'failed',
  review: 'gate',
};

function liveOwnershipWakes(db: Db, todoId: string): StepRow[] {
  const provs = new Set([watchProvenance(todoId), reportProvenance(todoId)]);
  return db
    .select()
    .from(step)
    .where(
      and(eq(step.kind, 'chief'), inArray(step.status, [...UNSTARTED_STEP_STATUSES, 'claimed'])),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all()
    .filter((row) => {
      const trigger = parseChiefTrigger(row.prompt);
      if (trigger !== 'wake' && trigger !== 'gate' && trigger !== 'failed') return false;
      const provenance = turnProvenance(row.prompt);
      return provenance !== null && provs.has(provenance);
    });
}

function coordinatorTurnState(db: Db, row: TodoRow, workKey: string, now: number): TurnState {
  const turn = row.coordinatorTurn;
  if (turn === null || turn.workKey !== workKey) return 'running';
  const wake = db
    .select({ status: step.status, createdAt: step.createdAt })
    .from(step)
    .where(eq(step.id, turn.stepId))
    .get();
  const liveSibling =
    wake === undefined || wake.status !== 'claimed'
      ? liveOwnershipWakes(db, row.id).some((live) => live.id !== turn.stepId)
      : false;
  if (wake === undefined || ENDED_STEP.has(wake.status)) return liveSibling ? 'running' : 'ended';
  if (wake.status === 'claimed') return 'running';
  if (now - wake.createdAt < COORDINATOR_TURN_DEADLINE_MS) return 'running';
  return liveSibling ? 'running' : 'never-started';
}

export function ownershipOf(db: Db, row: TodoRow, now = nowMs()): Ownership | null {
  const ownership = workOwnership(db, row);
  if (ownership?.owner !== 'coordinator') return ownership;
  if (coordinatorTurnState(db, row, ownership.workKey, now) === 'running') return ownership;
  return {
    owner: 'owner',
    reason: 'handoff',
    from: ownership.reason,
    workKey: `${ownership.workKey}:unclaimed`,
  };
}

function workOwnership(db: Db, row: TodoRow): Ownership | null {
  if (row.archivedAt !== null || row.supersededBy !== null || isEndedPhase(row.phase)) return null;
  const pending = row.latestBuildId === null ? [] : pendingQuestionIds(db, row.latestBuildId);
  if (pending.length > 0) {
    return {
      owner: 'coordinator',
      reason: 'question',
      workKey: `question:${row.latestBuildId}:${pending.join(',')}`,
    };
  }
  const blocked = blockedOwnership(db, row);
  if (blocked !== null) return blocked;
  if (row.phase === 'confirm') {
    if (row.latestBuildId !== null && planAwaitsAutoConfirm({ db }, row.latestBuildId)) return null;
    return { owner: 'owner', reason: 'confirm', workKey: `confirm:${phaseWork(row)}` };
  }
  if (row.phase === 'review') return reviewOwnership(row);
  if (row.phase === 'failed') return failedOwnership(db, row);
  return null;
}

export function ownerOf(db: Db, row: TodoRow): TodoOwner {
  return ownershipOf(db, row)?.owner ?? null;
}

export const TASKS_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export function sectionOf(
  row: Pick<TodoRow, 'phase' | 'phaseAt' | 'archivedAt'>,
  ownership: Ownership | null,
  now = Date.now(),
  waitsOnBlockers = false,
): TodoSection | null {
  if (isEndedPhase(row.phase)) {
    return row.phaseAt >= now - TASKS_RECENT_MS ? 'resolved' : null;
  }
  if (row.archivedAt !== null) return null;
  if (ownership?.owner === 'owner') {
    const reason = ownership.reason === 'handoff' ? ownership.from : ownership.reason;
    return reason === 'review' ? 'ready_for_review' : 'needs_input';
  }
  if (ownership === null && waitsOnBlockers) return 'up_next';
  return row.phase === 'todo' ? 'up_next' : 'working';
}

export function coordinatorAcceptsReview(ownership: Ownership | null): boolean {
  if (ownership === null) return false;
  if (ownership.reason === 'handoff') return ownership.from === 'review';
  return ownership.owner === 'coordinator' && ownership.reason === 'review';
}

const PUSH_TITLE: Record<NeedsYouReason, string> = {
  question: '需要你决定',
  confirm: '方案已就绪',
  review: '构建待审核',
  handoff: '协调者交给你处理',
};

function notifyOwner(deps: OwnerDeps, row: TodoRow, reason: NeedsYouReason): void {
  notifyOwnership(deps, row, reason);
  pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, row.teamId, {
    title: PUSH_TITLE[reason],
    body: `#${row.seqNum} ${row.title}`,
    href: `/app/todo/${row.id}`,
    tag: `${deps.user.id}:${row.id}`,
  });
}

function claimCheckpoint(db: Db, row: TodoRow, owner: string, workKey: string): boolean {
  const unchanged =
    row.lastNotifiedOwner === null
      ? isNull(todo.lastNotifiedOwner)
      : and(
          eq(todo.lastNotifiedOwner, row.lastNotifiedOwner),
          row.lastNotifiedWork === null
            ? isNull(todo.lastNotifiedWork)
            : eq(todo.lastNotifiedWork, row.lastNotifiedWork),
        );
  return (
    db
      .update(todo)
      .set({ lastNotifiedOwner: owner, lastNotifiedWork: workKey })
      .where(and(eq(todo.id, row.id), unchanged))
      .run().changes === 1
  );
}

function cancelUnstartedWake(deps: OwnerDeps, row: TodoRow): void {
  if (row.coordinatorTurn === null) return;
  const target = deps.db
    .select({ status: step.status })
    .from(step)
    .where(eq(step.id, row.coordinatorTurn.stepId))
    .get();
  if (target !== undefined && !UNSTARTED_STEP_STATUSES.includes(target.status as 'pending')) return;
  const [stopped] = deps.db
    .update(step)
    .set({ status: 'stopped', finishedAt: nowMs() })
    .where(eq(step.id, row.coordinatorTurn.stepId))
    .returning()
    .all();
  if (stopped === undefined) return;
  settleChiefActiveRun(deps.db, stopped.buildId);
  publishStepRow(deps, stopped);
}

function wakeTurnIntact(db: Db, row: TodoRow, workKey: string): boolean {
  const turn = row.coordinatorTurn;
  if (turn === null || turn.workKey !== workKey) return false;
  const wake = db.select({ status: step.status }).from(step).where(eq(step.id, turn.stepId)).get();
  if (wake === undefined || ENDED_STEP.has(wake.status)) return false;
  return (
    db
      .select({ id: dueEvent.id })
      .from(dueEvent)
      .where(eq(dueEvent.id, ownershipHandoffEventId(turn.stepId)))
      .get() !== undefined
  );
}

function adoptWakeStepId(db: Db, row: TodoRow, reason: CoordinatorReason): string | null {
  const trigger = OWNERSHIP_WAKE_TRIGGERS[reason];
  return (
    liveOwnershipWakes(db, row.id).find((wake) => parseChiefTrigger(wake.prompt) === trigger)?.id ??
    null
  );
}

function reconcileRow(deps: OwnerDeps, row: TodoRow): void {
  const ownership = ownershipOf(deps.db, row);
  const owner = ownership?.owner ?? NOBODY;
  const workKey = ownership?.workKey ?? '';
  const checkpointMatch = row.lastNotifiedOwner === owner && row.lastNotifiedWork === workKey;
  if (checkpointMatch && (owner !== 'coordinator' || wakeTurnIntact(deps.db, row, workKey))) return;
  if (ownership?.owner === 'coordinator') {
    let stepId: string;
    try {
      stepId = deps.db.transaction((tx) => {
        if (!claimCheckpoint(deps.db, row, owner, workKey)) return tx.rollback();
        const adopted = checkpointMatch ? adoptWakeStepId(deps.db, row, ownership.reason) : null;
        const stepId = adopted ?? enqueueOwnershipWake(deps, row, ownership.reason);
        if (stepId === null) return tx.rollback();
        deps.db
          .update(todo)
          .set({ coordinatorTurn: { stepId, workKey } })
          .where(eq(todo.id, row.id))
          .run();
        const queued = deps.db
          .select({ createdAt: step.createdAt })
          .from(step)
          .where(eq(step.id, stepId))
          .get();
        if (queued !== undefined)
          deps.db
            .insert(dueEvent)
            .values({
              id: ownershipHandoffEventId(stepId),
              kind: OWNERSHIP_HANDOFF_KIND,
              dueAt: queued.createdAt + COORDINATOR_TURN_DEADLINE_MS,
            })
            .onConflictDoNothing()
            .run();
        return stepId;
      });
    } catch (err) {
      if (err instanceof TransactionRollbackError) return;
      throw err;
    }
  } else if (!claimCheckpoint(deps.db, row, owner, workKey)) return;
  if (row.lastNotifiedOwner !== owner) {
    const record = getTodo(deps, row.id);
    if (record !== null) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (ownership === null || ownership.owner !== 'owner') return;
  if (ownership.reason === 'handoff') cancelUnstartedWake(deps, row);
  notifyOwner(deps, row, ownership.reason);
}

export function rescheduleOwnershipHandoff(db: Db, fromStepId: string, toStepId: string): void {
  db.delete(dueEvent)
    .where(eq(dueEvent.id, ownershipHandoffEventId(fromStepId)))
    .run();
  const queued = db
    .select({ createdAt: step.createdAt })
    .from(step)
    .where(eq(step.id, toStepId))
    .get();
  if (queued === undefined) return;
  db.insert(dueEvent)
    .values({
      id: ownershipHandoffEventId(toStepId),
      kind: OWNERSHIP_HANDOFF_KIND,
      dueAt: queued.createdAt + COORDINATOR_TURN_DEADLINE_MS,
    })
    .onConflictDoNothing()
    .run();
}

export function handoffUnclaimedOwnershipWake(
  deps: OwnerDeps,
  stepId: string,
  now: number,
): number | null {
  const wake = deps.db
    .select({ status: step.status, createdAt: step.createdAt })
    .from(step)
    .where(eq(step.id, stepId))
    .get();
  if (wake === undefined || ENDED_STEP.has(wake.status) || wake.status === 'claimed') return null;
  const dueAt = wake.createdAt + COORDINATOR_TURN_DEADLINE_MS;
  if (now < dueAt) return dueAt;
  const row = deps.db
    .select()
    .from(todo)
    .where(sql`json_extract(${todo.coordinatorTurn}, '$.stepId') = ${stepId}`)
    .get();
  if (row?.coordinatorTurn?.stepId !== stepId) return null;
  const current = deps.db.select().from(todo).where(eq(todo.id, row.id)).get();
  if (current === undefined) return null;
  const decided = ownershipOf(deps.db, current, now);
  if (decided?.owner !== 'owner' || decided.reason !== 'handoff') return null;
  const fresh = deps.db.select().from(todo).where(eq(todo.id, current.id)).get();
  if (fresh === undefined) return null;
  cancelUnstartedWake(deps, fresh);
  reconcileRow(deps, fresh);
  return null;
}

export function seedOwnerCheckpoints(db: Db): number {
  const rows = db.select().from(todo).where(isNull(todo.lastNotifiedOwner)).all();
  for (const row of rows) {
    const ownership = ownershipOf(db, row);
    db.update(todo)
      .set({
        lastNotifiedOwner: ownership?.owner ?? NOBODY,
        lastNotifiedWork: ownership?.workKey ?? '',
      })
      .where(and(eq(todo.id, row.id), isNull(todo.lastNotifiedOwner)))
      .run();
  }
  return rows.length;
}

export function reconcileOwners(deps: OwnerDeps, todoIds?: readonly string[]): void {
  const rows = deps.db
    .select()
    .from(todo)
    .where(
      todoIds === undefined
        ? or(OWNED_CANDIDATE, ne(todo.lastNotifiedOwner, NOBODY), isNull(todo.lastNotifiedOwner))
        : inArray(todo.id, [...todoIds]),
    )
    .all();
  for (const row of rows) reconcileRow(deps, row);
}
