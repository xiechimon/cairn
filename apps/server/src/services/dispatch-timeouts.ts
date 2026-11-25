import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export const DEAD_TURN_MS = 45_000;
export const ABANDONED_CLAIM_QUARANTINE_LIMIT = 3;

export function stepActivityAt(row: {
  lastHeartbeatAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}): number {
  return row.lastHeartbeatAt ?? row.claimedAt ?? row.createdAt;
}

export function claimIsDead(
  db: Db,
  row: {
    machineId: string | null;
    lastHeartbeatAt: number | null;
    claimedAt: number | null;
    createdAt: number;
  },
  now: number,
): boolean {
  if (now - stepActivityAt(row) > DEAD_TURN_MS) return true;
  if (row.machineId === null) return false;
  const runner = db
    .select({ retiredAt: machine.retiredAt })
    .from(machine)
    .where(eq(machine.id, row.machineId))
    .get();
  return runner === undefined || runner.retiredAt !== null;
}

export function isClaimedStepDead(
  db: Db,
  machineHub: { silentSinceDrop: (machineId: string) => boolean } | undefined,
  head: {
    machineId: string | null;
    lastHeartbeatAt: number | null;
    claimedAt: number | null;
    createdAt: number;
  },
  now: number = nowMs(),
): boolean {
  if (head.machineId == null) return false;
  const runner = db.select().from(machine).where(eq(machine.id, head.machineId)).get();
  const reachable =
    runner?.online === true &&
    runner.retiredAt === null &&
    machineHub?.silentSinceDrop(runner.id) !== true;
  return !reachable || now - stepActivityAt(head) > DEAD_TURN_MS;
}

export const QUOTA_HOLD_BACKOFF_MS: readonly [number, number, number] = [60_000, 300_000, 900_000];

export function quotaHoldBackoffMs(holdCount: number): number {
  const [firstHold, secondHold, thirdHold] = QUOTA_HOLD_BACKOFF_MS;
  const step = Math.min(Math.max(holdCount, 1), QUOTA_HOLD_BACKOFF_MS.length);
  if (step <= 1) return firstHold;
  if (step < 3) return secondHold;
  return thirdHold;
}

export function quotaHoldNote(message: string, retryAt: number): string {
  const when = new Date(retryAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `等额度：模型额度用尽，已挂起等待恢复（${message}）。下次尝试 ${when}，额度恢复后将自动继续，无需人工重新运行。`;
}
