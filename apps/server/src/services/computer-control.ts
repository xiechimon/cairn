import { COMPUTER_CONTROL_LEASE_MS, type ComputerControlLease } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { ownedPrivateComputer } from './computer-access.js';
import { HANDOFF_CLEARED } from './computer-handoff.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export function ownedComputer(db: Db, teamId: string, userId: string, computerId: string) {
  const row = ownedPrivateComputer(db, teamId, userId, computerId);
  if (!row) throw new HttpError(404, 'computer not found');
  return row;
}

export function hasComputerControl(
  row: typeof computer.$inferSelect,
  leaseId: string | undefined,
  now = Date.now(),
): boolean {
  return (
    row.controlHolder === 'user' &&
    row.controlLeaseId !== null &&
    row.controlLeaseId === leaseId &&
    row.controlLeaseExpiresAt !== null &&
    row.controlLeaseExpiresAt > now
  );
}

export function acquireComputerControl(
  db: Db,
  machineHub: MachineWakeHub,
  teamId: string,
  userId: string,
  computerId: string,
): ComputerControlLease {
  return db.transaction((tx) => {
    const row = ownedComputer(tx, teamId, userId, computerId);
    const now = Date.now();
    if (!machineHub.isConnected(row.machineId))
      throw new HttpError(409, 'the computer is not connected');
    const lease = {
      leaseId: newRecordId(),
      expiresAt: now + COMPUTER_CONTROL_LEASE_MS,
      controlFence: row.controlFence + 1,
    };
    tx.update(computer)
      .set({
        controlHolder: 'user',
        controlLeaseId: lease.leaseId,
        controlLeaseExpiresAt: lease.expiresAt,
        controlFence: lease.controlFence,
        updatedAt: now,
      })
      .where(eq(computer.id, computerId))
      .run();
    return lease;
  });
}

export function renewComputerControl(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  leaseId: string,
): ComputerControlLease {
  return db.transaction((tx) => {
    const row = ownedComputer(tx, teamId, userId, computerId);
    const now = Date.now();
    if (!hasComputerControl(row, leaseId, now))
      throw new HttpError(409, 'a live control lease is required');
    const expiresAt = Math.max(row.controlLeaseExpiresAt ?? 0, now + COMPUTER_CONTROL_LEASE_MS);
    tx.update(computer)
      .set({ controlLeaseExpiresAt: expiresAt, updatedAt: now })
      .where(eq(computer.id, computerId))
      .run();
    return { leaseId, expiresAt, controlFence: row.controlFence };
  });
}

export function releaseComputerControl(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  leaseId: string,
): void {
  db.transaction((tx) => {
    const row = ownedComputer(tx, teamId, userId, computerId);
    if (row.controlHolder === 'none') return;
    if (row.controlHolder !== 'user' || row.controlLeaseId !== leaseId)
      throw new HttpError(409, 'a matching control lease is required');
    tx.update(computer)
      .set({
        controlHolder: 'none',
        controlLeaseId: null,
        controlLeaseExpiresAt: null,
        controlFence: row.controlFence + 1,
        ...HANDOFF_CLEARED,
        updatedAt: Date.now(),
      })
      .where(eq(computer.id, computerId))
      .run();
  });
}
