import { FIXED_TAGS, TAG_DEFAULT_COLOR } from '@cairn/shared';
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

export function normalizeGithubLabelColor(color: string | null | undefined): string {
  if (typeof color === 'string') {
    if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color.toLowerCase()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  }
  return TAG_DEFAULT_COLOR;
}

export function syncGithubLabels(
  db: Db,
  projectId: string,
  labels: readonly { name: string; color: string | null }[],
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const label of labels) {
    const color = normalizeGithubLabelColor(label.color);
    const existing = db
      .select({ id: tag.id, color: tag.color })
      .from(tag)
      .where(and(eq(tag.projectId, projectId), eq(tag.name, label.name)))
      .get();
    if (existing === undefined) {
      db.insert(tag)
        .values({
          id: newRecordId(),
          projectId,
          name: label.name,
          color,
          createdAt: nowMs(),
          v: 1,
        })
        .run();
      inserted += 1;
    } else if (existing.color !== color) {
      db.update(tag).set({ color }).where(eq(tag.id, existing.id)).run();
      updated += 1;
    }
  }
  return { inserted, updated };
}

export function listProjectTagVocab(db: Db, projectId: string): { name: string }[] {
  return db.select({ name: tag.name }).from(tag).where(eq(tag.projectId, projectId)).all();
}

export function resolveProjectTagIds(
  db: Db,
  projectId: string,
  names: readonly string[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const name of names) {
    if (resolved.has(name)) continue;
    const row = db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.projectId, projectId), eq(tag.name, name)))
      .get();
    if (row) resolved.set(name, row.id);
  }
  return resolved;
}
