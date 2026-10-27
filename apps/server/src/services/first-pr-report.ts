import { DEFAULT_FIRST_PR_REPORT_PROMPT, type FirstPrReportPrompt } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, team, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export function readFirstPrReportPrompt(db: Db, teamId: string): FirstPrReportPrompt {
  const row = db
    .select({
      enabled: team.firstPrReportPromptEnabled,
      dismissedAt: team.firstPrReportPromptDismissedAt,
      firstPrAt: team.firstPrReportPromptFirstPrAt,
      firstPrNumber: team.firstPrReportPromptFirstPrNumber,
    })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  if (row === undefined) return { ...DEFAULT_FIRST_PR_REPORT_PROMPT };
  return {
    enabled: row.enabled,
    due: row.firstPrAt !== null && row.dismissedAt === null,
    dismissedAt: row.dismissedAt,
    firstPrAt: row.firstPrAt,
    firstPrNumber: row.firstPrNumber,
  };
}

export function setFirstPrReportPrompt(
  db: Db,
  teamId: string,
  patch: { enabled?: boolean; dismissed?: boolean },
): FirstPrReportPrompt {
  const set: Partial<typeof team.$inferInsert> = {};
  if (patch.enabled !== undefined) set.firstPrReportPromptEnabled = patch.enabled;
  if (patch.dismissed !== undefined) {
    set.firstPrReportPromptDismissedAt = patch.dismissed ? nowMs() : null;
  }
  if (Object.keys(set).length > 0) {
    db.update(team).set(set).where(eq(team.id, teamId)).run();
  }
  return readFirstPrReportPrompt(db, teamId);
}

export function markFirstPrPromptDue(db: Db, buildId: string): void {
  const row = db
    .select({
      teamId: todo.teamId,
      prNumber: build.prNumber,
      createdAt: build.createdAt,
    })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, buildId))
    .get();
  if (row === undefined || row.prNumber === null) return;
  db.update(team)
    .set({
      firstPrReportPromptFirstPrAt: row.createdAt,
      firstPrReportPromptFirstPrNumber: row.prNumber,
    })
    .where(
      and(
        eq(team.id, row.teamId),
        eq(team.firstPrReportPromptEnabled, true),
        isNull(team.firstPrReportPromptFirstPrAt),
        isNull(team.firstPrReportPromptDismissedAt),
      ),
    )
    .run();
}

export function daysToFirstPr(teamCreatedAt: number, firstPrAt: number): number | null {
  const elapsed = firstPrAt - teamCreatedAt;
  if (elapsed < 0) return null;
  return Math.floor(elapsed / 86_400_000);
}
