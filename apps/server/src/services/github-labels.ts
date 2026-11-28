import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubLabel, todoGithubLabel } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export function listProjectGithubLabelVocab(db: Db, projectId: string): { name: string }[] {
  return db
    .select({ name: githubLabel.name })
    .from(githubLabel)
    .where(eq(githubLabel.projectId, projectId))
    .all();
}

export function resolveProjectGithubLabelIds(
  db: Db,
  projectId: string,
  names: readonly string[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const name of new Set(names)) {
    const row = db
      .select({ id: githubLabel.id })
      .from(githubLabel)
      .where(and(eq(githubLabel.projectId, projectId), eq(githubLabel.name, name)))
      .get();
    if (row) resolved.set(name, row.id);
  }
  return resolved;
}

export function todoGithubLabelIds(db: Db, todoId: string): string[] {
  return db
    .select({ id: todoGithubLabel.labelId })
    .from(todoGithubLabel)
    .where(eq(todoGithubLabel.todoId, todoId))
    .all()
    .map((row) => row.id);
}

export function assertGithubLabelsInProject(
  db: Db,
  projectId: string,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  const owned = new Set(
    db
      .select({ id: githubLabel.id })
      .from(githubLabel)
      .where(and(eq(githubLabel.projectId, projectId), inArray(githubLabel.id, [...ids])))
      .all()
      .map((row) => row.id),
  );
  for (const id of ids) {
    if (!owned.has(id)) throw new HttpError(400, `GitHub label ${id} not in project`);
  }
}

export function correctionFromGithubLabels(db: Db, ids: string[]): boolean {
  return (
    ids.length > 0 &&
    db
      .select({ id: githubLabel.id })
      .from(githubLabel)
      .where(and(inArray(githubLabel.id, ids), eq(sql`lower(${githubLabel.name})`, 'correction')))
      .get() !== undefined
  );
}
