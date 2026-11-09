import {
  ASK_USER_QUESTION_KIND,
  type NeedsYouReason,
  type TodoOwner,
  type TodoSection,
} from '@cairn/shared';
import { and, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, gateState, message, project, todo } from '../db/schema.js';
import { planAwaitsAutoConfirm } from './builds.js';
import { type ChiefDeps, enqueueOwnershipWake } from './chief.js';
import { failureAwaitsAutomaticRetry } from './needs-you.js';
import { notifyOwnership } from './notifications.js';
import { projectMergeConfigOf } from './projects.js';
import { pushToUserSafely, type VapidKeys } from './push.js';
import { endSnoozeOn } from './snooze.js';
import { getTodo } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

export type CoordinatorReason = 'question' | 'failed' | 'review';

export type Ownership =
  | { owner: 'owner'; reason: NeedsYouReason; workKey: string }
  | { owner: 'coordinator'; reason: CoordinatorReason; workKey: string };

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
  if (row.output === 'info') {
    return policy === 'human' ? { owner: 'coordinator', reason: 'review', workKey } : null;
  }
  const buildRow =
    row.latestBuildId === null
      ? undefined
      : db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  const gate =
    buildRow === undefined
      ? undefined
      : db.select().from(gateState).where(eq(gateState.buildId, buildRow.id)).get();
  const prGate =
    buildRow?.prNumber != null &&
    projectRow?.repoKind === 'github' &&
    projectRow.githubRepo !== null;
  if (prGate && (gate === undefined || gate.evaluatedAt < row.phaseAt)) return null;
  const blockers = gate?.blockers ?? [];
  if (gate !== undefined && !gate.ready && blockers.some((b) => b.class === 'transient')) {
    return null;
  }
  if (policy === 'human' || blockers.some((b) => b.class === 'human')) {
    return { owner: 'owner', reason: 'review', workKey };
  }
  return null;
}

function failedOwnership(db: Db, row: TodoRow): Ownership | null {
  if (row.latestBuildId === null) return null;
  const buildRow = db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  if (buildRow === undefined || failureAwaitsAutomaticRetry(db, buildRow)) return null;
  return { owner: 'coordinator', reason: 'failed', workKey: `failed:${phaseWork(row)}` };
}

export function ownershipOf(db: Db, row: TodoRow): Ownership | null {
  if (row.archivedAt !== null || row.phase === 'done' || row.phase === 'closed') return null;
  const pending = row.latestBuildId === null ? [] : pendingQuestionIds(db, row.latestBuildId);
  if (pending.length > 0) {
    return {
      owner: 'coordinator',
      reason: 'question',
      workKey: `question:${row.latestBuildId}:${pending.join(',')}`,
    };
  }
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
  return ownership?.owner === 'coordinator' && ownership.reason === 'review';
}

const PUSH_TITLE: Record<NeedsYouReason, string> = {
  question: '需要你决定',
  confirm: '方案已就绪',
  review: '构建待审核',
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
  if (ownership.owner === 'owner') notifyOwner(deps, row, ownership.reason);
  else enqueueOwnershipWake(deps, row, ownership.reason);
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
