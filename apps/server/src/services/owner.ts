import type { NeedsYouReason, TodoOwner } from '@cairn/shared';
import { and, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, gateState, project, todo } from '../db/schema.js';
import { type ChiefDeps, enqueueOwnershipWake } from './chief.js';
import { failureAwaitsAutomaticRetry } from './needs-you.js';
import { notifyOwnership } from './notifications.js';
import { projectMergeConfigOf } from './projects.js';
import { pushToUserSafely, type VapidKeys } from './push.js';
import { endSnoozeOn } from './snooze.js';
import { getTodo } from './todos.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

type TodoRow = typeof todo.$inferSelect;

export type CoordinatorReason = 'question' | 'failed' | 'review';

export type Ownership =
  | { owner: 'owner'; reason: NeedsYouReason; workKey: string }
  | { owner: 'coordinator'; reason: CoordinatorReason; workKey: string };

export interface OwnerDeps extends ChiefDeps {
  vapidKeys?: VapidKeys | null;
}

const NOBODY = 'none';

export const OWNED_CANDIDATE: SQL = and(
  isNull(todo.archivedAt),
  or(inArray(todo.phase, ['confirm', 'review', 'failed']), eq(todo.awaitingReply, true)),
) as SQL;

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
  if (row.awaitingReply && row.latestBuildId !== null) {
    const pending = pendingWorkerQuestions(db, row.latestBuildId).map((q) => q.requestId);
    if (pending.length > 0) {
      return {
        owner: 'coordinator',
        reason: 'question',
        workKey: `question:${row.latestBuildId}:${pending.sort().join(',')}`,
      };
    }
  }
  if (row.phase === 'confirm') {
    return { owner: 'owner', reason: 'confirm', workKey: `confirm:${phaseWork(row)}` };
  }
  if (row.phase === 'review') return reviewOwnership(db, row);
  if (row.phase === 'failed') return failedOwnership(db, row);
  return null;
}

export function ownerOf(db: Db, row: TodoRow): TodoOwner {
  return ownershipOf(db, row)?.owner ?? null;
}

const PUSH_TITLE: Record<NeedsYouReason, string> = {
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
  if (row.lastNotifiedOwner === null) return;
  if (row.lastNotifiedOwner !== owner) {
    const record = getTodo(deps, row.id);
    if (record !== null) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (ownership === null) return;
  if (ownership.owner === 'owner') notifyOwner(deps, row, ownership.reason);
  else enqueueOwnershipWake(deps, row, ownership.reason);
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
