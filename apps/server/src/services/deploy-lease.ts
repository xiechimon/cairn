import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { deployLease } from '../db/schema.js';
import { conflict } from '../lib/errors.js';

export function readDeployLease(db: Db) {
  const row = db.select().from(deployLease).where(eq(deployLease.id, 'server')).get();
  return {
    owner: row?.owner ?? null,
    status:
      row?.status === 'draining' && row.expiresAt > Date.now()
        ? ('draining' as const)
        : ('accepting' as const),
    expiresAt: row?.expiresAt ?? 0,
  };
}

export function updateDeployLease(db: Db, owner: string, ttlMs: number | null) {
  return db.transaction(
    (tx) => {
      const current = readDeployLease(tx);
      if (current.status === 'draining' && current.owner !== owner) {
        throw conflict('deployment lease belongs to another owner');
      }
      if (ttlMs === null && current.owner !== null && current.owner !== owner) {
        throw conflict('cannot release another deployment lease');
      }
      const next = {
        id: 'server',
        owner,
        status: ttlMs === null ? ('accepting' as const) : ('draining' as const),
        expiresAt: ttlMs === null ? 0 : Date.now() + ttlMs,
      };
      tx.insert(deployLease)
        .values(next)
        .onConflictDoUpdate({ target: deployLease.id, set: next })
        .run();
      return readDeployLease(tx);
    },
    { behavior: 'immediate' },
  );
}
