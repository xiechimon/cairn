import { FIXED_TAGS } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, tag } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export function seedFixedTags(db: Db, projectId: string): number {
  const existing = new Set(
    db
      .select({ name: tag.name })
      .from(tag)
      .where(eq(tag.projectId, projectId))
      .all()
      .map((r) => r.name),
  );
  let inserted = 0;
  for (const def of FIXED_TAGS) {
    if (existing.has(def.name)) continue;
    db.insert(tag)
      .values({
        id: newRecordId(),
        projectId,
        name: def.name,
        color: def.color,
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}

export function backfillFixedTags(db: Db): void {
  const rows = db.select({ id: project.id, repoKind: project.repoKind }).from(project).all();
  for (const row of rows) {
    if (row.repoKind === 'github') continue;
    seedFixedTags(db, row.id);
  }
}

export function resolveFixedTagId(db: Db, projectId: string, name: string): string | null {
  const row = db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.projectId, projectId), eq(tag.name, name)))
    .get();
  return row?.id ?? null;
}
