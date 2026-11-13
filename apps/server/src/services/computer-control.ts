import { COMPUTER_CONTROL_LEASE_MS, type ComputerControlLease } from '@cairn/shared';
import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer, computerCall } from '../db/schema.js';
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
    const driving = tx
      .select({ id: computerCall.id })
      .from(computerCall)
      .where(
        and(
          eq(computerCall.computerId, row.id),
          eq(computerCall.replaySafe, false),
          ne(computerCall.tool, 'request_takeover'),
          or(
            inArray(computerCall.state, ['dispatched', 'running']),
            and(
              eq(computerCall.state, 'cancelled'),
              isNull(computerCall.finishedAt),
              gt(computerCall.deadlineAt, now),
            ),
          ),
        ),
      )
      .get();
    if (driving) throw new HttpError(409, 'Stop the Coordinator first');
    const executionHeld =
      row.executionStepId !== null &&
      row.executionLeaseExpiresAt !== null &&
      row.executionLeaseExpiresAt > now;
    const botControlHeld =
      row.controlHolder === 'bot' &&
      (row.controlLeaseExpiresAt === null || row.controlLeaseExpiresAt > now);
    if (executionHeld || botControlHeld) {
      const waiting =
        row.executionStepId === null
          ? undefined
          : tx
              .select({ id: computerCall.id })
              .from(computerCall)
              .where(
                and(
                  eq(computerCall.computerId, row.id),
                  eq(computerCall.stepId, row.executionStepId),
                  eq(computerCall.tool, 'request_takeover'),
                  gt(computerCall.deadlineAt, now),
                  inArray(computerCall.state, ['dispatched', 'running']),
                ),
              )
              .get();
      if (!waiting) throw new HttpError(409, 'Stop the Coordinator first');
    }
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
