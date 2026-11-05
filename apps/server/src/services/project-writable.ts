import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export function assertProjectWritable(db: Db, teamId: string, projectId: string): void {
  const row = db
    .select({ archivedAt: project.archivedAt })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (row?.archivedAt != null)
    throw new HttpError(409, `project ${projectId} is archived; unarchive it before changing it`);
}
