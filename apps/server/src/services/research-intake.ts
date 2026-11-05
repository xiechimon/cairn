import {
  RESEARCH_INTAKE_SOURCE_KIND,
  RESEARCH_INTAKE_THREAD_TITLES_MAX,
  researchIntakeQuestion,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { chief, project, todo } from '../db/schema.js';
import type { BuildDeps } from './builds.js';
import { localDay, retryPendingIntakeReports } from './chief-report.js';
import { recentIntakeItems } from './intake-items.js';
import { planResearchCitationChecks } from './research-citations.js';
import { openResearchThread } from './research-thread.js';
import { serverTimezone, wallClockParts } from './schedules.js';

export const RESEARCH_INTAKE_HOUR = 6;

const OPEN_PHASES = ['todo', 'queued', 'planning', 'confirm', 'building', 'review'] as const;

function intakeTimezone(configured: string | null | undefined): string {
  const tz = configured ?? serverTimezone();
  try {
    localDay(0, tz);
    return tz;
  } catch {
    return serverTimezone();
  }
}

export function planResearchIntake(deps: BuildDeps, projectId: string | null, now: number): void {
  planResearchCitationChecks(deps);
  retryPendingIntakeReports(deps, now);
  if (projectId === null) return;
  const { db } = deps;
  const projectRow = db.select().from(project).where(eq(project.id, projectId)).get();
  if (projectRow === undefined) return;
  const teamId = projectRow.teamId;
  const chiefRow = db.select().from(chief).where(eq(chief.teamId, teamId)).get();
  const tz = intakeTimezone(chiefRow?.tz);
  if (wallClockParts(now, tz).hour < RESEARCH_INTAKE_HOUR) return;
  const day = localDay(now, tz);
  const openThreadTitles = db
    .select({ title: todo.title })
    .from(todo)
    .where(
      and(
        eq(todo.projectId, projectId),
        inArray(todo.phase, [...OPEN_PHASES]),
        isNull(todo.archivedAt),
        or(
          isNull(todo.sourceKind),
          notInArray(todo.sourceKind, [RESEARCH_INTAKE_SOURCE_KIND, 'research-citation-check']),
        ),
      ),
    )
    .orderBy(desc(todo.phaseAt))
    .limit(RESEARCH_INTAKE_THREAD_TITLES_MAX)
    .all()
    .map((row) => row.title);
  openResearchThread(deps, {
    teamId,
    projectId,
    title: `Daily intake ${day}`,
    question: researchIntakeQuestion({
      openThreadTitles,
      previousItems: recentIntakeItems(db, teamId, now),
    }),
    tier: 2,
    source: { kind: RESEARCH_INTAKE_SOURCE_KIND, ref: `research-intake:${day}` },
  });
}
