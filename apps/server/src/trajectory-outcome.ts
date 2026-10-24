import { and, asc, eq, gt, inArray, like, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { build, message, step } from './db/schema.js';
import { DONE_ROW, prClosedUnmergedRow } from './services/delivery-rows.js';

export const REVERT_PROMPT_HEAD = '[revert]';

export const REVERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PackOutcomeSignals {
  merged: boolean | null;
  revertedWithin7d: boolean | null;
  fixedByLaterPr: boolean | null;
  revertWindowOpen: boolean;
}

export function derivePackOutcome(
  db: BetterSQLite3Database,
  b: { id: string; todoId: string; prNumber: number | null },
  now: number,
): PackOutcomeSignals {
  const closedRow = b.prNumber === null ? [] : [prClosedUnmergedRow(b.prNumber)];
  const verdicts = db
    .select({ content: message.content, at: message.createdAt })
    .from(message)
    .where(and(eq(message.conversationId, b.id), eq(message.role, 'system')))
    .orderBy(asc(message.createdAt), asc(message.id))
    .all()
    .filter((row) => row.content === DONE_ROW || closedRow.includes(String(row.content)));
  const latest = verdicts.at(-1);
  if (latest === undefined)
    return { merged: null, revertedWithin7d: null, fixedByLaterPr: null, revertWindowOpen: false };
  if (latest.content !== DONE_ROW)
    return { merged: false, revertedWithin7d: null, fixedByLaterPr: null, revertWindowOpen: false };
  const windowEnd = latest.at + REVERT_WINDOW_MS;
  const laterBuilds = db
    .select({ id: build.id, createdAt: build.createdAt, prNumber: build.prNumber })
    .from(build)
    .where(and(eq(build.todoId, b.todoId), ne(build.id, b.id), gt(build.createdAt, latest.at)))
    .all();
  const revertBuildIds = new Set(
    laterBuilds.length === 0
      ? []
      : db
          .select({ buildId: step.buildId })
          .from(step)
          .where(
            and(
              inArray(
                step.buildId,
                laterBuilds.map((later) => later.id),
              ),
              like(step.prompt, `${REVERT_PROMPT_HEAD}%`),
            ),
          )
          .all()
          .map((row) => row.buildId),
  );
  const reverted = laterBuilds.some(
    (later) => revertBuildIds.has(later.id) && later.createdAt <= windowEnd,
  );
  const fixed = laterBuilds.some(
    (later) => later.prNumber !== null && !revertBuildIds.has(later.id),
  );
  const revertWindowOpen = now < windowEnd;
  return {
    merged: true,
    revertedWithin7d: revertWindowOpen ? null : reverted,
    fixedByLaterPr: fixed ? true : revertWindowOpen ? null : false,
    revertWindowOpen,
  };
}
