import { isBuildStepKind } from '@cairn/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step } from '../db/schema.js';

export function stepNamesTask(
  db: Db,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'kind' | 'buildId'>,
): boolean {
  if (!isBuildStepKind(stepRow.kind)) return false;
  const buildRow = db
    .select({ todoId: build.todoId })
    .from(build)
    .where(eq(build.id, stepRow.buildId))
    .get();
  if (buildRow === undefined) return false;
  return !db
    .select({ kind: step.kind })
    .from(step)
    .innerJoin(build, eq(build.id, step.buildId))
    .where(and(eq(build.todoId, buildRow.todoId), eq(step.status, 'done'), ne(step.id, stepRow.id)))
    .all()
    .some((row) => isBuildStepKind(row.kind));
}
