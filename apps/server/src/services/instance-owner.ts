import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pairedDevice, user } from '../db/schema.js';

export function isOwner(db: Pick<Db, 'select'>, userId: string): boolean {
  const first = db.select({ id: user.id }).from(user).orderBy(sql`rowid`).limit(1).get();
  return first?.id === userId;
}

export function isOwnerDecider(db: Pick<Db, 'select'>, decider: string, teamId: string): boolean {
  if (isOwner(db, decider)) return true;
  if (!decider.startsWith('device:')) return false;
  const deviceId = decider.slice('device:'.length);
  if (deviceId === '') return false;
  return (
    db
      .select({ id: pairedDevice.id })
      .from(pairedDevice)
      .where(and(eq(pairedDevice.id, deviceId), eq(pairedDevice.teamId, teamId)))
      .get() !== undefined
  );
}
