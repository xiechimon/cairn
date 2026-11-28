import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dueEvent } from '../db/schema.js';

export const DUE_BACKOFF_BASE_MS = 1_000;
export const DUE_BACKOFF_CAP_MS = 60_000;

export function dueBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 16);
  return Math.min(DUE_BACKOFF_CAP_MS, DUE_BACKOFF_BASE_MS * 2 ** exponent);
}

export class DueDeliveryCrash extends Error {
  constructor() {
    super('due delivery stopped before re-arm');
    this.name = 'DueDeliveryCrash';
  }
}

export interface DueClock {
  now(): number;
  setTimer(callback: () => void | Promise<void>, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface DueEventRecord {
  id: string;
  kind: string;
  dueAt: number;
  intervalMs: number | null;
  attempts: number;
  lastError: string | null;
}

export type DueHandlerResult =
  | undefined
  | { rescheduleAt: number | null; intervalMs?: number | null };

export type DueHandler = (event: DueEventRecord, now: number) => unknown;

export interface DueEventInput {
  id: string;
  kind: string;
  dueAt: number;
  intervalMs?: number | null;
}

export function createDueRunner(
  db: Db,
  clock: DueClock,
  handlers: Record<string, DueHandler>,
  beforeArm?: () => void,
) {
  let timer: unknown = null;
  let armedTarget: number | null = null;
  let arming = false;
  let ticking = false;
  const inFlight = new Set<string>();
  let stopped = false;

  function rows(): DueEventRecord[] {
    return db.select().from(dueEvent).orderBy(asc(dueEvent.dueAt), asc(dueEvent.id)).all();
  }

  function clearTimer(): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    armedTarget = null;
  }

  function retarget(): void {
    const now = clock.now();
    const upcoming = rows().filter((row) => row.dueAt > now || !inFlight.has(row.id));
    const nextAt = upcoming[0]?.dueAt;
    if (nextAt === undefined) {
      if (inFlight.size === 0) clearTimer();
      return;
    }
    if (armedTarget !== null && timer !== null && nextAt >= armedTarget) return;
    clearTimer();
    const delay = Math.max(0, nextAt - now);
    armedTarget = now + delay;
    timer = clock.setTimer(() => deliver(clock.now()), delay);
  }

  function arm(explicit: boolean): void {
    if (explicit) stopped = false;
    if (stopped || arming) return;
    arming = true;
    try {
      beforeArm?.();
      retarget();
    } finally {
      arming = false;
    }
  }

  function upsert(event: DueEventInput): void {
    db.insert(dueEvent)
      .values({
        id: event.id,
        kind: event.kind,
        dueAt: event.dueAt,
        intervalMs: event.intervalMs ?? null,
        attempts: 0,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: dueEvent.id,
        set: {
          kind: event.kind,
          dueAt: event.dueAt,
          intervalMs: event.intervalMs ?? null,
        },
      })
      .run();
    if (!arming && !ticking) arm(false);
  }

  function isThenable(value: unknown): value is Promise<unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'then' in value &&
      typeof value.then === 'function'
    );
  }

  function reserve(event: DueEventRecord, now: number): number {
    const reservedDueAt =
      event.intervalMs !== null ? now + event.intervalMs : now + DUE_BACKOFF_CAP_MS;
    db.update(dueEvent)
      .set(
        event.intervalMs !== null
          ? { dueAt: reservedDueAt, attempts: 0, lastError: null }
          : { dueAt: reservedDueAt },
      )
      .where(eq(dueEvent.id, event.id))
      .run();
    return reservedDueAt;
  }

  function handlerResult(value: unknown): DueHandlerResult {
    if (!value || typeof value !== 'object' || !('rescheduleAt' in value)) return undefined;
    const at = value.rescheduleAt;
    if (at !== null && typeof at !== 'number') return undefined;
    if (
      'intervalMs' in value &&
      (value.intervalMs === null || typeof value.intervalMs === 'number')
    ) {
      return { rescheduleAt: at, intervalMs: value.intervalMs };
    }
    return { rescheduleAt: at };
  }

  function finishSuccess(
    event: DueEventRecord,
    now: number,
    result: DueHandlerResult,
    expectedDueAt = event.dueAt,
  ): void {
    const matchesRow = and(eq(dueEvent.id, event.id), eq(dueEvent.dueAt, expectedDueAt));
    if (result && 'rescheduleAt' in result) {
      if (result.rescheduleAt === null) {
        db.delete(dueEvent).where(matchesRow).run();
        return;
      }
      db.update(dueEvent)
        .set({
          dueAt: result.rescheduleAt,
          attempts: 0,
          lastError: null,
          ...(result.intervalMs !== undefined ? { intervalMs: result.intervalMs } : {}),
        })
        .where(matchesRow)
        .run();
      return;
    }
    if (event.intervalMs !== null) {
      db.update(dueEvent)
        .set({ dueAt: now + event.intervalMs, attempts: 0, lastError: null })
        .where(matchesRow)
        .run();
      return;
    }
    db.delete(dueEvent).where(matchesRow).run();
  }

  function recordFailure(
    event: DueEventRecord,
    now: number,
    error: unknown,
    expectedDueAt = event.dueAt,
  ): void {
    const attempts = event.attempts + 1;
    db.update(dueEvent)
      .set({
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        dueAt: now + dueBackoffMs(attempts),
      })
      .where(and(eq(dueEvent.id, event.id), eq(dueEvent.dueAt, expectedDueAt)))
      .run();
  }

  async function settleDetached(
    event: DueEventRecord,
    now: number,
    value: Promise<unknown>,
    reservedDueAt: number,
  ): Promise<void> {
    try {
      const result = handlerResult(await value);
      if (event.intervalMs !== null && result === undefined) {
        db.update(dueEvent)
          .set({ attempts: 0, lastError: null })
          .where(and(eq(dueEvent.id, event.id), eq(dueEvent.dueAt, reservedDueAt)))
          .run();
        return;
      }
      finishSuccess(event, now, result, reservedDueAt);
    } catch (error) {
      if (error instanceof DueDeliveryCrash) throw error;
      recordFailure(event, clock.now(), error, reservedDueAt);
    }
  }

  async function deliver(now: number): Promise<void> {
    if (stopped || ticking) return;
    ticking = true;
    clearTimer();
    let crashed = false;
    const background: Promise<void>[] = [];
    try {
      const due = rows().filter((event) => !inFlight.has(event.id) && event.dueAt <= now);
      for (const event of due) {
        const handler = handlers[event.kind];
        try {
          if (!handler) throw new Error(`no handler for ${event.kind}`);
          const value = handler(event, now);
          if (isThenable(value)) {
            inFlight.add(event.id);
            const reservedDueAt = reserve(event, now);
            background.push(
              settleDetached(event, now, value, reservedDueAt).finally(() => {
                inFlight.delete(event.id);
              }),
            );
          } else {
            finishSuccess(event, now, handlerResult(value));
          }
        } catch (error) {
          if (error instanceof DueDeliveryCrash) {
            crashed = true;
            return;
          }
          recordFailure(event, now, error);
        }
      }
      ticking = false;
      if (!crashed) arm(false);
      const settled = await Promise.allSettled(background);
      if (settled.some((result) => result.status === 'rejected')) crashed = true;
    } finally {
      ticking = false;
      if (!crashed) arm(false);
    }
  }

  return {
    upsert,
    arm(): void {
      arm(true);
    },
    stop(): void {
      stopped = true;
      clearTimer();
    },
  };
}
