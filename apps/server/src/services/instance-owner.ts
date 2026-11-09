import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { user } from '../db/schema.js';

export function isOwner(db: Db, userId: string): boolean {
  const first = db.select({ id: user.id }).from(user).orderBy(sql`rowid`).limit(1).get();
  return first?.id === userId;
}
