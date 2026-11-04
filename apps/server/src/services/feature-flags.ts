import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { featureFlag, user } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

const FLAG_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

export function validFlagKey(key: string): boolean {
  return FLAG_KEY.test(key);
}

export function isOwner(db: Db, userId: string): boolean {
  const first = db.select({ id: user.id }).from(user).orderBy(sql`rowid`).limit(1).get();
  return first?.id === userId;
}

export function flag(db: Db, key: string, userId: string): boolean {
  const own = db
    .select({ enabled: featureFlag.enabled })
    .from(featureFlag)
    .where(and(eq(featureFlag.key, key), eq(featureFlag.userId, userId)))
    .get();
  if (own) return own.enabled;
  const global = db
    .select({ enabled: featureFlag.enabled })
    .from(featureFlag)
    .where(and(eq(featureFlag.key, key), isNull(featureFlag.userId)))
    .get();
  if (global) return global.enabled;
  return isOwner(db, userId);
}

export function listFlagReleases(db: Db): { key: string; released: boolean }[] {
  return db
    .select({
      key: featureFlag.key,
      released:
        sql<number>`max(case when ${featureFlag.userId} is null and ${featureFlag.enabled} = 1 then 1 else 0 end)`.mapWith(
          Boolean,
        ),
    })
    .from(featureFlag)
    .groupBy(featureFlag.key)
    .orderBy(featureFlag.key)
    .all();
}

export function setUserFlag(db: Db, key: string, userId: string, enabled: boolean): void {
  const now = nowMs();
  const existing = db
    .select({ id: featureFlag.id })
    .from(featureFlag)
    .where(and(eq(featureFlag.key, key), eq(featureFlag.userId, userId)))
    .get();
  if (existing) {
    db.update(featureFlag)
      .set({ enabled, updatedAt: now })
      .where(eq(featureFlag.id, existing.id))
      .run();
    return;
  }
  db.insert(featureFlag).values({ id: newRecordId(), key, userId, enabled, updatedAt: now }).run();
}

export function releaseFlag(db: Db, key: string): void {
  db.transaction((tx) => {
    tx.delete(featureFlag).where(eq(featureFlag.key, key)).run();
    tx.insert(featureFlag)
      .values({ id: newRecordId(), key, userId: null, enabled: true, updatedAt: nowMs() })
      .run();
  });
}
