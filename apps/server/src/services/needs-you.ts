import type { NeedsYouQuery } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, NotFoundError } from './builds.js';
import { OWNED_CANDIDATE, ownershipOf } from './owner.js';
import { PhaseTransitionError } from './phase.js';
import { automaticRetryDueAt, automaticRetryOwed, failureNeedsHuman } from './retry-parking.js';
import { getTodo } from './todos.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export { failureNeedsHuman };

export const NEEDS_YOU_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function failureAwaitsAutomaticRetry(
  db: Db,
  buildRow: { id: string; errorMessage: string | null; retryAttempt: number },
): boolean {
  return automaticRetryOwed(db, buildRow);
}

export function listNeedsYou(
  deps: Pick<BuildDeps, 'db'>,
  teamId: string,
  now = nowMs(),
): NeedsYouQuery {
  const entries = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.teamId, teamId), OWNED_CANDIDATE))
    .all()
    .flatMap((row) => {
      const ownership = ownershipOf(deps.db, row);
      return ownership?.owner === 'owner'
        ? [{ todoId: row.id, reason: ownership.reason, phaseAt: row.phaseAt }]
        : [];
    });
  entries.sort((a, b) => b.phaseAt - a.phaseAt || (a.todoId < b.todoId ? -1 : 1));
  const current: NeedsYouQuery['current'] = [];
  const stale: NeedsYouQuery['stale'] = [];
  for (const entry of entries) {
    const record = getTodo(deps, entry.todoId);
    if (record === null) continue;
    const item = { todo: record, reason: entry.reason };
    if (now - entry.phaseAt > NEEDS_YOU_STALE_MS) stale.push(item);
    else current.push(item);
  }
  return { current, stale };
}

export async function sweepFailedRetries(deps: BuildDeps): Promise<void> {
  const rows = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.phase, 'failed'), isNull(todo.archivedAt)))
    .all();
  for (const row of rows) {
    if (
      row.latestBuildId === null ||
      row.sourceKind === 'research-intake' ||
      row.sourceKind === 'research-citation-check'
    )
      continue;
    if (pendingWorkerQuestions(deps.db, row.latestBuildId).length > 0) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
    if (buildRow === undefined || !automaticRetryOwed(deps.db, buildRow)) continue;
    if (nowMs() < automaticRetryDueAt(row.phaseAt, buildRow.retryAttempt)) continue;
    try {
      await applyBuildStepAction(
        deps,
        buildRow.id,
        { action: 'restart', feedback: '', clientMessageId: newRecordId() },
        'cairn',
        'retry',
      );
    } catch (err) {
      if (
        err instanceof HttpError ||
        err instanceof PhaseTransitionError ||
        err instanceof NotFoundError
      ) {
        continue;
      }
      throw err;
    }
  }
}
