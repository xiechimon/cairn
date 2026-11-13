import {
  ASK_USER_QUESTION_KIND,
  type NeedsYouReason,
  type TodoOwner,
  type TodoSection,
  UNSTARTED_STEP_STATUSES,
} from '@cairn/shared';
import { and, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, dueEvent, gateState, message, project, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { BLOCKED_BY_HOLD, deadEndBlocker } from './blockers.js';
import { planAwaitsAutoConfirm } from './builds.js';
import { type ChiefDeps, enqueueOwnershipWake } from './chief.js';
import { settleChiefActiveRun } from './chief-turns.js';
import { projectRepoRef } from './git.js';
import { failureAwaitsAutomaticRetry } from './needs-you.js';
import { notifyOwnership } from './notifications.js';
import { projectMergeConfigOf, projectShipRouteOf } from './projects.js';
import { pushToUserSafely, type VapidKeys } from './push.js';
import { publishStepRow } from './quota-wait.js';
import { endSnoozeOn } from './snooze.js';
import { getTodo } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

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

function reviewOwnership(db: Db, row: TodoRow): Ownership | null {
  const projectRow = db.select().from(project).where(eq(project.id, row.projectId)).get();
  const policy =
    projectRow === undefined ? 'autonomous' : projectMergeConfigOf(projectRow).mergePolicy;
  const workKey = `review:${phaseWork(row)}`;
  const coordinatorReview: Ownership = { owner: 'coordinator', reason: 'review', workKey };
  if (row.output === 'info') return coordinatorReview;
  const buildRow =
    row.latestBuildId === null
      ? undefined
      : db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  const prGate =
    buildRow?.prNumber != null &&
    projectRow?.repoKind === 'github' &&
    projectRow.githubRepo !== null;
  const gate =
    buildRow === undefined
      ? undefined
      : db.select().from(gateState).where(eq(gateState.buildId, buildRow.id)).get();
  if (prGate && (gate === undefined || gate.evaluatedAt < row.phaseAt)) return null;
  const blockers = gate?.blockers ?? [];
  if (gate !== undefined && !gate.ready && blockers.some((b) => b.class === 'transient')) {
    return null;
  }
  if (policy === 'human' || blockers.some((b) => b.class === 'human')) {
    return { owner: 'owner', reason: 'review', workKey };
  }
  if (prGate) return null;
  const repo = projectRepoRef(projectRow, '');
  const personLands =
    repo !== null &&
    repo.kind !== 'github' &&
    row.hasChanges &&
    projectRow !== undefined &&
    projectShipRouteOf(projectRow) !== 'custom';
  return personLands ? { owner: 'owner', reason: 'review', workKey } : coordinatorReview;
}

function failedOwnership(db: Db, row: TodoRow): Ownership | null {
  if (row.latestBuildId === null) return null;
  const buildRow = db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  if (buildRow === undefined || failureAwaitsAutomaticRetry(db, buildRow)) return null;
  return { owner: 'coordinator', reason: 'failed', workKey: `failed:${phaseWork(row)}` };
}

function blockedOwnership(db: Db, row: TodoRow): Ownership | null {
  if (row.latestBuildId === null) return null;
  const held = db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, row.latestBuildId), eq(step.holdReason, BLOCKED_BY_HOLD)))
    .get();
  if (held === undefined) return null;
  const blocker = deadEndBlocker(db, row);
  if (blocker === null) return null;
  return {
    owner: 'coordinator',
    reason: 'blocked',
    workKey: `blocked:${blocker.id}:${blocker.phase}`,
  };
}

type TurnState = 'running' | 'ended' | 'never-started';

function coordinatorTurnState(db: Db, row: TodoRow, workKey: string, now: number): TurnState {
  const turn = row.coordinatorTurn;
  if (turn === null || turn.workKey !== workKey) return 'running';
  const wake = db
    .select({ status: step.status, createdAt: step.createdAt })
    .from(step)
    .where(eq(step.id, turn.stepId))
    .get();
  if (wake === undefined || ENDED_STEP.has(wake.status)) return 'ended';
  if (wake.status === 'claimed') return 'running';
  return now - wake.createdAt >= COORDINATOR_TURN_DEADLINE_MS ? 'never-started' : 'running';
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
  if (row.archivedAt !== null || row.phase === 'done' || row.phase === 'closed') return null;
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
  if (row.phase === 'review') return reviewOwnership(db, row);
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
): TodoSection | null {
  if (row.phase === 'done' || row.phase === 'closed') {
    return row.phaseAt >= now - TASKS_RECENT_MS ? 'resolved' : null;
  }
  if (row.archivedAt !== null) return null;
  if (ownership?.owner === 'owner') {
    return ownership.reason === 'review' ? 'ready_for_review' : 'needs_input';
  }
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
  endSnoozeOn(deps, row.id, 'needs-you');
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

function reconcileRow(deps: OwnerDeps, row: TodoRow): void {
  const ownership = ownershipOf(deps.db, row);
  const owner = ownership?.owner ?? NOBODY;
  const workKey = ownership?.workKey ?? '';
  if (row.lastNotifiedOwner === owner && row.lastNotifiedWork === workKey) return;
  if (!claimCheckpoint(deps.db, row, owner, workKey)) return;
  if (row.lastNotifiedOwner !== owner) {
    const record = getTodo(deps, row.id);
    if (record !== null) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (ownership === null) return;
  if (ownership.owner === 'owner') {
    if (ownership.reason === 'handoff') cancelUnstartedWake(deps, row);
    notifyOwner(deps, row, ownership.reason);
    return;
  }
  const stepId = enqueueOwnershipWake(deps, row, ownership.reason);
  if (stepId === null) return;
  deps.db
    .update(todo)
    .set({ coordinatorTurn: { stepId, workKey: ownership.workKey } })
    .where(eq(todo.id, row.id))
    .run();
  const queued = deps.db
    .select({ createdAt: step.createdAt })
    .from(step)
    .where(eq(step.id, stepId))
    .get();
  if (queued === undefined) return;
  deps.db
    .insert(dueEvent)
    .values({
      id: ownershipHandoffEventId(stepId),
      kind: OWNERSHIP_HANDOFF_KIND,
      dueAt: queued.createdAt + COORDINATOR_TURN_DEADLINE_MS,
    })
    .onConflictDoNothing()
    .run();
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
