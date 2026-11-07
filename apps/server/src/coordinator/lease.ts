import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coordinatorLease } from '../db/schema.js';

export const LEASE_STALE_MS = 45_000;

export interface Lease {
  heartbeat(): boolean;
  release(): void;
}

export class LeaseHeldError extends Error {
  constructor(storeKey: string) {
    super(`Coordinator store ${storeKey} is held by another process`);
    this.name = 'LeaseHeldError';
  }
}

export function acquireLease(
  db: Db,
  storeKey: string,
  owner: string,
  options: { now?: () => number; staleMs?: number } = {},
): Lease {
  const now = options.now ?? Date.now;
  const staleMs = options.staleMs ?? LEASE_STALE_MS;
  const at = now();
  const taken = db
    .insert(coordinatorLease)
    .values({ storeKey, owner, heartbeatAt: at })
    .onConflictDoUpdate({
      target: coordinatorLease.storeKey,
      set: { owner, heartbeatAt: at },
      setWhere: or(
        isNull(coordinatorLease.owner),
        eq(coordinatorLease.owner, owner),
        lt(coordinatorLease.heartbeatAt, at - staleMs),
      ),
    })
    .run();
  if (taken.changes === 0) throw new LeaseHeldError(storeKey);
  return {
    heartbeat: () =>
      db
        .update(coordinatorLease)
        .set({ heartbeatAt: now() })
        .where(and(eq(coordinatorLease.storeKey, storeKey), eq(coordinatorLease.owner, owner)))
        .run().changes > 0,
    release: () => {
      db.update(coordinatorLease)
        .set({ owner: null })
        .where(and(eq(coordinatorLease.storeKey, storeKey), eq(coordinatorLease.owner, owner)))
        .run();
    },
  };
}
