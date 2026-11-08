import {
  RESEARCH_INTAKE_SOURCE_KIND,
  RESEARCH_INTAKE_THREAD_TITLES_MAX,
  RESEARCH_STUCK_SOURCE_KIND,
  researchIntakeQuestion,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import { build, chief, project, todo } from '../db/schema.js';
import type { BuildDeps } from './builds.js';
import { localDay, retryPendingIntakeReports } from './chief-report.js';
import { type TransitionActor, transitionTodos } from './chief-tools.js';
import { recentIntakeItems } from './intake-items.js';
import { CITATION_CHECK_SOURCE_KIND } from './needs-you.js';
import { planResearchCitationChecks } from './research-citations.js';
import { releaseResearchReworkHolds } from './research-stuck.js';
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
  releaseResearchReworkHolds(deps, now);
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
          notInArray(todo.sourceKind, [
            RESEARCH_INTAKE_SOURCE_KIND,
            'research-citation-check',
            RESEARCH_STUCK_SOURCE_KIND,
          ]),
        ),
      ),
    )
    .orderBy(desc(todo.phaseAt))
    .limit(RESEARCH_INTAKE_THREAD_TITLES_MAX)
    .all()
    .map((row) => row.title);
  const current = `research-intake:${day}`;
  openResearchThread(deps, {
    teamId,
    projectId,
    title: `Daily intake ${day}`,
    question: researchIntakeQuestion({
      openThreadTitles,
      previousItems: recentIntakeItems(db, teamId, now),
    }),
    tier: 2,
    source: { kind: RESEARCH_INTAKE_SOURCE_KIND, ref: current },
  });
  closeSupersededIntakes(deps, teamId, projectId, current);
}

const UNDELIVERED_PHASES = [
  'todo',
  'queued',
  'planning',
  'building',
  'needs_input',
  'failed',
] as const;
const SUPERSEDED_ACTOR: TransitionActor = {
  kind: 'agent',
  name: 'Daily intake',
  stopActor: 'system',
};

function closeSupersededIntakes(
  deps: BuildDeps,
  teamId: string,
  projectId: string,
  current: string,
): void {
  const stale = deps.db
    .select({ id: todo.id })
    .from(todo)
    .where(
      and(
        eq(todo.projectId, projectId),
        eq(todo.sourceKind, RESEARCH_INTAKE_SOURCE_KIND),
        ne(todo.sourceRef, current),
        inArray(todo.phase, [...UNDELIVERED_PHASES]),
        isNull(todo.archivedAt),
      ),
    )
    .all()
    .map((row) => row.id);
  if (stale.length === 0) return;
  const staleBuilds = deps.db
    .select({ id: build.id })
    .from(build)
    .where(inArray(build.todoId, stale))
    .all()
    .map((row) => row.id);
  const checks = deps.db
    .select({ id: todo.id, sourceRef: todo.sourceRef })
    .from(todo)
    .where(
      and(
        eq(todo.teamId, teamId),
        eq(todo.sourceKind, CITATION_CHECK_SOURCE_KIND),
        notInArray(todo.phase, ['done', 'closed']),
        isNull(todo.archivedAt),
      ),
    )
    .all()
    .filter((row) => staleBuilds.some((buildId) => row.sourceRef?.startsWith(`${buildId}:`)))
    .map((row) => row.id);
  transitionTodos(deps, teamId, [...stale, ...checks], 'closed', SUPERSEDED_ACTOR);
}
