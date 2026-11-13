import type { ComputerTool } from '@cairn/shared';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer, computerCall } from '../db/schema.js';

export const COMPUTER_HANDOFF_TIMEOUT_MS = 15 * 60_000;
export const COMPUTER_HANDOFF_POLL_MS = 500;

export const HANDOFF_NAVIGATE_REFUSED =
  'A login or human check is waiting on this computer. browser_navigate is refused. Call request_takeover so the owner can handle it.';
export const HANDOFF_OWNER_CONTROL_REFUSED =
  'The owner has control of this computer, so browser_snapshot and computer_observe are refused. Wait for request_takeover to return.';
export const TAKEOVER_HANDED_BACK =
  'The owner handed the computer back. Take a fresh browser_snapshot before acting.';
export const TAKEOVER_NOT_DONE =
  'The owner did not finish. This step is not done. Stop and tell the owner.';
export const TAKEOVER_NO_COMPUTER = 'There is no Coordinator computer to hand over.';

export const HANDOFF_CLEARED = {
  handoffReason: null,
  handoffStepId: null,
  handoffRequestedAt: null,
} as const;

type ComputerRow = typeof computer.$inferSelect;

export function markHandoff(
  db: Db,
  computerId: string,
  reason: 'login' | 'model',
  stepId: string,
  now: number,
): void {
  db.update(computer)
    .set({ handoffReason: reason, handoffStepId: stepId, handoffRequestedAt: now, updatedAt: now })
    .where(eq(computer.id, computerId))
    .run();
}

export function markHandoffIfNone(
  db: Db,
  computerId: string,
  reason: 'login' | 'model',
  stepId: string,
  now: number,
): void {
  const row = db.select().from(computer).where(eq(computer.id, computerId)).get();
  if (row && row.handoffReason === null) markHandoff(db, computerId, reason, stepId, now);
}

export function clearHandoff(db: Db, computerId: string): void {
  db.update(computer).set(HANDOFF_CLEARED).where(eq(computer.id, computerId)).run();
}

export function ownerHoldsControl(row: ComputerRow, now: number): boolean {
  return (
    row.controlHolder === 'user' &&
    (row.controlLeaseExpiresAt === null || row.controlLeaseExpiresAt > now)
  );
}

export function handoffRefusal(
  row: ComputerRow | undefined,
  tool: ComputerTool,
  now: number,
): string | null {
  if (!row) return null;
  if (tool === 'browser_navigate' && row.handoffReason !== null) return HANDOFF_NAVIGATE_REFUSED;
  if ((tool === 'browser_snapshot' || tool === 'computer_observe') && ownerHoldsControl(row, now)) {
    return HANDOFF_OWNER_CONTROL_REFUSED;
  }
  return null;
}

export function sweepComputerHandoffs(db: Db, now: number): void {
  const orphaned = db
    .select({
      id: computerCall.id,
      computerId: computerCall.computerId,
      stepId: computerCall.stepId,
    })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.tool, 'request_takeover'),
        inArray(computerCall.state, ['dispatched', 'running']),
      ),
    )
    .all();
  for (const call of orphaned) {
    db.update(computerCall)
      .set({
        state: 'error',
        errorMessage: 'the server restarted before the owner finished',
        errorDelivery: 'not_delivered',
        finishedAt: now,
      })
      .where(eq(computerCall.id, call.id))
      .run();
    if (call.computerId !== null) clearHandoff(db, call.computerId);
    db.update(computer)
      .set({ executionStepId: null, executionLeaseExpiresAt: null })
      .where(eq(computer.executionStepId, call.stepId))
      .run();
  }
  db.update(computer)
    .set(HANDOFF_CLEARED)
    .where(
      and(
        isNotNull(computer.handoffReason),
        lte(computer.handoffRequestedAt, now - COMPUTER_HANDOFF_TIMEOUT_MS),
      ),
    )
    .run();
}

export function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
