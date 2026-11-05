import { asc, eq } from 'drizzle-orm';
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

export type DueHandlerResult = undefined | { rescheduleAt: number | null };

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
  let delivering = false;
  let activeHandlers = 0;
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
    const upcoming = rows();
    const nextAt =
      activeHandlers > 0 ? upcoming.find((row) => row.dueAt > now)?.dueAt : upcoming[0]?.dueAt;
    if (nextAt === undefined) {
      if (activeHandlers === 0) clearTimer();
      return;
    }
    if (armedTarget !== null && timer !== null && nextAt >= armedTarget) return;
    clearTimer();
    const delay = Math.max(0, nextAt - now);
    if (activeHandlers > 0 && delay === 0) return;
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
    if (!arming && !delivering) arm(false);
  }

  function isThenable(value: unknown): value is Promise<unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'then' in value &&
      typeof value.then === 'function'
    );
  }

  function reserve(event: DueEventRecord, now: number): void {
    db.update(dueEvent)
      .set(
        event.intervalMs !== null
          ? { dueAt: now + event.intervalMs, attempts: 0, lastError: null }
          : { dueAt: now + DUE_BACKOFF_CAP_MS },
      )
      .where(eq(dueEvent.id, event.id))
      .run();
  }

  function handlerResult(value: unknown): DueHandlerResult {
    if (!value || typeof value !== 'object' || !('rescheduleAt' in value)) return undefined;
    const at = value.rescheduleAt;
    if (at !== null && typeof at !== 'number') return undefined;
    return { rescheduleAt: at };
  }

  function finishSuccess(event: DueEventRecord, now: number, result: DueHandlerResult): void {
    if (result && 'rescheduleAt' in result) {
      if (result.rescheduleAt === null) {
        db.delete(dueEvent).where(eq(dueEvent.id, event.id)).run();
        return;
      }
      db.update(dueEvent)
        .set({ dueAt: result.rescheduleAt, attempts: 0, lastError: null })
        .where(eq(dueEvent.id, event.id))
        .run();
      return;
    }
    if (event.intervalMs !== null) {
      db.update(dueEvent)
        .set({ dueAt: now + event.intervalMs, attempts: 0, lastError: null })
        .where(eq(dueEvent.id, event.id))
        .run();
      return;
    }
    db.delete(dueEvent).where(eq(dueEvent.id, event.id)).run();
  }

  function recordFailure(event: DueEventRecord, now: number, error: unknown): void {
    const attempts = event.attempts + 1;
    db.update(dueEvent)
      .set({
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        dueAt: now + dueBackoffMs(attempts),
      })
      .where(eq(dueEvent.id, event.id))
      .run();
  }

  async function settleDetached(
    event: DueEventRecord,
    now: number,
    value: Promise<unknown>,
  ): Promise<void> {
    try {
      const result = handlerResult(await value);
      if (event.intervalMs !== null && result === undefined) {
        db.update(dueEvent)
          .set({ attempts: 0, lastError: null })
          .where(eq(dueEvent.id, event.id))
          .run();
        return;
      }
      finishSuccess(event, now, result);
    } catch (error) {
      if (error instanceof DueDeliveryCrash) throw error;
      recordFailure(event, clock.now(), error);
    }
  }

  async function deliver(now: number): Promise<void> {
    if (delivering) {
      clearTimer();
      return;
    }
    delivering = true;
    clearTimer();
    let crashed = false;
    const background: Promise<void>[] = [];
    try {
      const due = rows().filter((event) => event.dueAt <= now);
      for (const event of due) {
        const handler = handlers[event.kind];
        try {
          if (!handler) throw new Error(`no handler for ${event.kind}`);
          const value = handler(event, now);
          if (isThenable(value)) {
            activeHandlers += 1;
            reserve(event, now);
            background.push(
              settleDetached(event, now, value).finally(() => {
                activeHandlers -= 1;
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
      if (!crashed) arm(false);
      const settled = await Promise.allSettled(background);
      if (settled.some((result) => result.status === 'rejected')) crashed = true;
    } finally {
      delivering = false;
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
