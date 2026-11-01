import type { ChiefThread } from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import { chiefThread, type project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type ChiefDeps, ensureChief, sendChiefMessage, toChiefThreadRecord } from './chief.js';

type ProjectRow = typeof project.$inferSelect;

function coordinatorThreadRow(deps: ChiefDeps, projectRow: ProjectRow) {
  const chiefRow = ensureChief(deps, projectRow.teamId);
  return deps.db
    .select()
    .from(chiefThread)
    .where(and(eq(chiefThread.chiefId, chiefRow.id), eq(chiefThread.projectId, projectRow.id)))
    .orderBy(desc(chiefThread.updatedAt))
    .get();
}

export function projectCoordinatorThread(
  deps: ChiefDeps,
  projectRow: ProjectRow,
): ChiefThread | null {
  const row = coordinatorThreadRow(deps, projectRow);
  return row === undefined ? null : toChiefThreadRecord(row);
}

export function sendProjectCoordinatorMessage(
  deps: ChiefDeps,
  projectRow: ProjectRow,
  content: string,
): ReturnType<typeof sendChiefMessage> {
  if (projectRow.archivedAt !== null) {
    throw new HttpError(409, `project ${projectRow.id} is archived`);
  }
  const existing = coordinatorThreadRow(deps, projectRow);
  return sendChiefMessage(
    deps,
    projectRow.teamId,
    { threadId: existing?.id ?? null, content, projectId: projectRow.id },
    true,
  );
}
