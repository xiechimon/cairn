import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { hostedCleanupOutbox, project } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { removeHostedRepoDir } from './git.js';

type CleanupTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const RETRY_MS = 30_000;

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
      db.update(hostedCleanupOutbox)
        .set({ state: 'conflict', lastError: 'a project owns this repo name' })
        .where(eq(hostedCleanupOutbox.id, row.id))
        .run();
      continue;
    }
    try {
      removeHostedRepoDir(reposDir, row.teamId, row.repoName);
      db.update(hostedCleanupOutbox)
        .set({ state: 'done', lastError: null })
        .where(eq(hostedCleanupOutbox.id, row.id))
        .run();
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
    }
  }
  return due.length;
}
