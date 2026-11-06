import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { composerDraft } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export const COMPOSER_DRAFT_MAX_CHARS = 100_000;
export const COMPOSER_DRAFT_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPOSER_DRAFT_SCOPE_RE = /^(chief|todo:[A-Za-z0-9_-]{1,64})$/;

export interface DraftOwner {
  teamId: string;
  userId: string;
  scope: string;
}

export interface DraftSnapshot {
  content: string;
  updatedAt: number | null;
}

function ownerWhere(owner: DraftOwner) {
  return and(
    eq(composerDraft.teamId, owner.teamId),
    eq(composerDraft.userId, owner.userId),
    eq(composerDraft.scope, owner.scope),
  );
}

export function readComposerDraft(db: Db, owner: DraftOwner): DraftSnapshot {
  const row = db.select().from(composerDraft).where(ownerWhere(owner)).get();
  return row === undefined
    ? { content: '', updatedAt: null }
    : { content: row.content, updatedAt: row.updatedAt };
}

export function writeComposerDraft(
  db: Db,
  owner: DraftOwner,
  content: string,
  now: number = nowMs(),
): DraftSnapshot {
  const existing = db.select().from(composerDraft).where(ownerWhere(owner)).get();
  if (content === '') {
    if (existing !== undefined) db.delete(composerDraft).where(ownerWhere(owner)).run();
    return { content: '', updatedAt: null };
  }
  if (existing === undefined) {
    db.insert(composerDraft)
      .values({ id: newRecordId(), ...owner, content, updatedAt: now })
      .run();
    return { content, updatedAt: now };
  }
  const updatedAt = Math.max(now, existing.updatedAt + 1);
  db.update(composerDraft).set({ content, updatedAt }).where(ownerWhere(owner)).run();
  return { content, updatedAt };
}

export function sweepIdleComposerDrafts(db: Db, now: number = nowMs()): number {
  return db
    .delete(composerDraft)
    .where(lt(composerDraft.updatedAt, now - COMPOSER_DRAFT_IDLE_TTL_MS))
    .returning({ id: composerDraft.id })
    .all().length;
}
