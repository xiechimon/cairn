import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';

export function projectInstructionsSection(
  db: Db,
  teamId: string,
  projectId: string | null,
): string | null {
  if (projectId === null) return null;
  const row = db
    .select({ name: project.name, instructions: project.instructions })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (row?.instructions == null) return null;
  return `## 项目说明（${row.name.replace(/[\r\n]+/g, ' ')}）\n${row.instructions}`;
}
