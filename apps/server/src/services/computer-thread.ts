import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, type step } from '../db/schema.js';
import { isChiefConversation } from './machine-deps.js';

export type ComputerThread = Pick<
  typeof chiefThread.$inferSelect,
  'id' | 'chiefId' | 'userId' | 'teamId'
>;

export const NO_CARD_THREAD = '';

export function browserScopeFor(thread: Pick<ComputerThread, 'id' | 'chiefId'>): string {
  return thread.id === NO_CARD_THREAD ? `chief-fallback:${thread.chiefId}` : thread.id;
}

export function computerThreadOf(
  db: Pick<Db, 'select'>,
  stepRow: Pick<typeof step.$inferSelect, 'kind' | 'buildId'>,
): ComputerThread | null {
  if (stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId)) {
    return db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get() ?? null;
  }
  return null;
}
