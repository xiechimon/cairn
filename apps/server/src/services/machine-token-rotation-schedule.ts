import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dueEvent, machine } from '../db/schema.js';

export const MACHINE_TOKEN_ROTATION_EVENT_KIND = 'machine-token-rotate';
export const MACHINE_TOKEN_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const MACHINE_TOKEN_ROTATION_RETRY_MS = 60 * 60 * 1000;
export const MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS = 5_000;

export function machineTokenRotationEventId(machineId: string): string {
  return `token-rotate:${machineId}`;
}

const clockListeners = new WeakMap<Db, () => void>();
const activeAutoRotationsByDb = new WeakMap<Db, Set<string>>();

export function setActiveAutoRotation(db: Db, machineId: string, active: boolean): void {
  let activeSet = activeAutoRotationsByDb.get(db);
  if (active) {
    if (activeSet === undefined) {
      activeSet = new Set();
      activeAutoRotationsByDb.set(db, activeSet);
    }
    activeSet.add(machineId);
    return;
  }
  activeSet?.delete(machineId);
  if (activeSet !== undefined && activeSet.size === 0) {
    activeAutoRotationsByDb.delete(db);
  }
}

export function setMachineTokenRotationClockListener(db: Db, listener: (() => void) | null): void {
  if (listener === null) {
    clockListeners.delete(db);
    return;
  }
  clockListeners.set(db, listener);
}

function notifyClock(db: Db): void {
  clockListeners.get(db)?.();
}

export function scheduleMachineTokenRotation(
  db: Db,
  machineId: string,
  dueAt = Date.now() + MACHINE_TOKEN_ROTATION_INTERVAL_MS,
): void {
  const id = machineTokenRotationEventId(machineId);
  db.insert(dueEvent)
    .values({
      id,
      kind: MACHINE_TOKEN_ROTATION_EVENT_KIND,
      dueAt,
      intervalMs: null,
      attempts: 0,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: dueEvent.id,
      set: { dueAt, intervalMs: null, attempts: 0, lastError: null },
    })
    .run();
  notifyClock(db);
}

export function cancelMachineTokenRotation(db: Db, machineId: string): void {
  db.delete(dueEvent)
    .where(eq(dueEvent.id, machineTokenRotationEventId(machineId)))
    .run();
  notifyClock(db);
}

export function armOverdueTokenRotationOnConnect(
  db: Db,
  machineId: string,
  now = Date.now(),
  opts: { intervalMs?: number; retryMs?: number; graceMs?: number } = {},
): void {
  const intervalMs = opts.intervalMs ?? MACHINE_TOKEN_ROTATION_INTERVAL_MS;
  const retryMs = opts.retryMs ?? MACHINE_TOKEN_ROTATION_RETRY_MS;
  const graceMs = opts.graceMs ?? MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS;
  const id = machineTokenRotationEventId(machineId);
  const existing = db.select().from(dueEvent).where(eq(dueEvent.id, id)).get();
  if (!existing) {
    scheduleMachineTokenRotation(db, machineId, now + intervalMs);
    return;
  }
  const activeNow = activeAutoRotationsByDb.get(db)?.has(machineId) ?? false;
  const inRetryOrOverdue =
    activeNow || existing.dueAt <= now || existing.intervalMs !== null || existing.attempts > 0;
  if (!inRetryOrOverdue) return;
  if (existing.dueAt > now && existing.dueAt <= now + graceMs) return;
  db.update(dueEvent)
    .set({
      dueAt: now + graceMs,
      intervalMs: retryMs,
      attempts: 0,
      lastError: null,
    })
    .where(eq(dueEvent.id, id))
    .run();
  notifyClock(db);
}

function staggeredInitialDueAt(machineId: string, now: number, intervalMs: number): number {
  const minDelay = Math.floor(intervalMs * 0.5);
  const spread = Math.max(1, intervalMs - minDelay + 1);
  const hash = createHash('sha256').update(machineId).digest().readUInt32BE(0);
  return now + minDelay + (hash % spread);
}

export function syncMachineTokenRotationDueEvents(
  db: Db,
  now: number,
  intervalMs = MACHINE_TOKEN_ROTATION_INTERVAL_MS,
): void {
  const activeIds = new Set<string>();
  const eventIdsWithRows = new Set<string>();
  for (const event of db.select().from(dueEvent).all()) {
    if (event.kind === MACHINE_TOKEN_ROTATION_EVENT_KIND) {
      eventIdsWithRows.add(event.id);
    }
  }
  for (const row of db.select().from(machine).all()) {
    if (row.retiredAt !== null || row.tokenHash === null) continue;
    const eventId = machineTokenRotationEventId(row.id);
    activeIds.add(eventId);
    if (!eventIdsWithRows.has(eventId)) {
      db.insert(dueEvent)
        .values({
          id: eventId,
          kind: MACHINE_TOKEN_ROTATION_EVENT_KIND,
          dueAt: staggeredInitialDueAt(row.id, now, intervalMs),
          intervalMs: null,
          attempts: 0,
          lastError: null,
        })
        .onConflictDoNothing()
        .run();
    }
  }
  for (const eventId of eventIdsWithRows) {
    if (!activeIds.has(eventId)) {
      db.delete(dueEvent).where(eq(dueEvent.id, eventId)).run();
    }
  }
}
