import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionJournal, hostedCleanupOutbox, project } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { removeHostedRepoDir } from './git.js';

type CleanupTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type CleanupRow = typeof hostedCleanupOutbox.$inferSelect;

const RETRY_MS = 30_000;

function cleanupJournal(tx: CleanupTx, row: CleanupRow, outcome: 'done' | 'conflict', now: number) {
  const keyed = tx.select().from(actionJournal).where(eq(actionJournal.id, row.id)).get();
  const recorded =
    keyed ??
    tx
      .select()
      .from(actionJournal)
      .where(
        and(
          eq(actionJournal.teamId, row.teamId),
          eq(actionJournal.actionId, 'project.delete'),
          eq(actionJournal.targetId, row.projectId),
          eq(actionJournal.kind, 'run'),
        ),
      )
      .orderBy(desc(actionJournal.createdAt))
      .get();
  return {
    id: newRecordId(),
    teamId: row.teamId,
    actionId: recorded?.actionId ?? 'project.delete',
    targetId: recorded?.targetId ?? row.projectId,
    actor: recorded?.actor ?? 'user',
    surface: recorded?.surface ?? 'web',
    kind: outcome === 'conflict' ? ('error' as const) : ('run' as const),
    inputHash:
      recorded?.inputHash ??
      createHash('sha256')
        .update(JSON.stringify({ cleanup: outcome }))
        .digest('hex'),
    createdAt: now,
  };
}

function recordCleanup(
  db: Db,
  row: CleanupRow,
  outcome: 'done' | 'conflict',
  lastError: string | null,
  now: number,
): void {
  try {
    db.transaction(
      (tx) => {
        tx.update(hostedCleanupOutbox)
          .set({ state: outcome, lastError })
          .where(eq(hostedCleanupOutbox.id, row.id))
          .run();
        tx.insert(actionJournal)
          .values(cleanupJournal(tx, row, outcome, now))
          .run();
      },
      { behavior: 'immediate' },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Hosted cleanup ${row.id} outcome was not recorded: ${reason}\n`);
  }
}

export function enqueueHostedCleanup(
  tx: CleanupTx,
  row: { id: string; teamId: string; repoKind: string | null; repoName: string | null },
  journalId: string,
): void {
  if (row.repoKind !== 'hosted' || row.repoName === null) return;
  const existing = tx
    .select()
    .from(hostedCleanupOutbox)
    .where(
      and(
        eq(hostedCleanupOutbox.teamId, row.teamId),
        eq(hostedCleanupOutbox.repoName, row.repoName),
        inArray(hostedCleanupOutbox.state, ['pending', 'retrying', 'conflict']),
      ),
    )
    .get();
  if (existing) {
    tx.update(hostedCleanupOutbox)
      .set({
        id: journalId,
        projectId: row.id,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: nowMs(),
        lastError: null,
      })
      .where(eq(hostedCleanupOutbox.id, existing.id))
      .run();
    return;
  }
  tx.insert(hostedCleanupOutbox)
    .values({
      id: journalId,
      teamId: row.teamId,
      projectId: row.id,
      repoName: row.repoName,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: nowMs(),
      lastError: null,
    })
    .run();
}

export function dispatchHostedCleanup(db: Db, reposDir: string, now = nowMs()): number {
  const due = db
    .select()
    .from(hostedCleanupOutbox)
    .where(
      and(
        inArray(hostedCleanupOutbox.state, ['pending', 'retrying']),
        lte(hostedCleanupOutbox.nextAttemptAt, now),
      ),
    )
    .all();
  for (const row of due) {
    const owner = db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.teamId, row.teamId), eq(project.repoName, row.repoName)))
      .get();
    if (owner) {
      recordCleanup(db, row, 'conflict', 'a project owns this repo name', now);
      continue;
    }
    try {
      removeHostedRepoDir(reposDir, row.teamId, row.repoName);
    } catch (error) {
      db.update(hostedCleanupOutbox)
        .set({
          state: 'retrying',
          attempts: row.attempts + 1,
          nextAttemptAt: now + RETRY_MS * (row.attempts + 1),
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(hostedCleanupOutbox.id, row.id))
        .run();
      continue;
    }
    recordCleanup(db, row, 'done', null, now);
  }
  return due.length;
}
