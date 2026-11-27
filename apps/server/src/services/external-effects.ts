import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, lte, or, type SQLWrapper, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, externalEffect, step } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export const EFFECT_CLAIM_STALE_MS = 120_000;
export const EFFECT_MAX_ATTEMPTS = 8;

export type EffectRow = typeof externalEffect.$inferSelect;
export type EffectScopeKind = EffectRow['scopeKind'];
export type EffectPolicy = 'probe' | 'replay-safe' | 'unsafe';
export type EffectProbeVerdict =
  | { verdict: 'delivered'; receipt?: unknown }
  | { verdict: 'unsent' }
  | { verdict: 'unknown' };

export interface EffectKindDef {
  policy: EffectPolicy;
  send?: (row: EffectRow, db: Db) => Promise<unknown>;
  probe?: (row: EffectRow) => Promise<EffectProbeVerdict>;
  scopeGone?: (db: Db, row: EffectRow) => boolean;
}

export type EffectKindRegistry = Map<string, EffectKindDef>;

export function createEffectRegistry(): EffectKindRegistry {
  return new Map();
}

export const effectRegistry: EffectKindRegistry = createEffectRegistry();

export class EffectRetry extends Error {
  retryAfterMs: number | undefined;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export class EffectWait extends Error {
  retryAfterMs: number | undefined;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export class EffectFail extends Error {
  countHealth: boolean;
  constructor(message: string, countHealth = true) {
    super(message);
    this.countHealth = countHealth;
  }
}

export function retryEffect(message: string, retryAfterMs?: number): EffectRetry {
  return new EffectRetry(message, retryAfterMs);
}

export function waitEffect(message: string, retryAfterMs?: number): EffectWait {
  return new EffectWait(message, retryAfterMs);
}

export function failEffect(message: string, countHealth = true): EffectFail {
  return new EffectFail(message, countHealth);
}

export function effectBackoffMs(attempts: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, attempts), 300_000);
}

export function effectDedupeKey(...parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface EffectIntent {
  teamId: string;
  scopeKind: EffectScopeKind;
  scopeId: string;
  stepId?: string;
  claimGeneration?: number;
  kind: string;
  dedupeKey: string;
  payload: unknown;
  dueAt?: number;
}

export function recordEffect(db: Db, intent: EffectIntent): { row: EffectRow; created: boolean } {
  const now = nowMs();
  const res = db
    .insert(externalEffect)
    .values({
      id: newRecordId(),
      teamId: intent.teamId,
      scopeKind: intent.scopeKind,
      scopeId: intent.scopeId,
      stepId: intent.stepId ?? null,
      claimGeneration: intent.claimGeneration ?? null,
      kind: intent.kind,
      dedupeKey: intent.dedupeKey,
      payload: intent.payload,
      state: 'pending',
      dueAt: intent.dueAt ?? now,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: externalEffect.dedupeKey })
    .run();
  const row = db
    .select()
    .from(externalEffect)
    .where(eq(externalEffect.dedupeKey, intent.dedupeKey))
    .get();
  if (row === undefined) throw new Error('external_effect insert/select mismatch');
  return { row, created: res.changes > 0 };
}

export function claimEffect(db: Db, id: string, now = nowMs()): EffectRow | null {
  const claimed = db
    .update(externalEffect)
    .set({ state: 'sending', claimedAt: now, claimFence: now, updatedAt: now })
    .where(and(eq(externalEffect.id, id), eq(externalEffect.state, 'pending')))
    .returning()
    .get();
  return claimed ?? null;
}

export function markEffectDelivered(db: Db, id: string, fence: number, receipt: unknown): boolean {
  return (
    db
      .update(externalEffect)
      .set({ state: 'delivered', receipt, updatedAt: nowMs() })
      .where(
        and(
          eq(externalEffect.id, id),
          eq(externalEffect.state, 'sending'),
          eq(externalEffect.claimFence, fence),
        ),
      )
      .run().changes > 0
  );
}

export type EffectAttemptOutcome =
  | { state: 'pending'; dueAt: number; lastError: string; countAttempt?: boolean }
  | { state: 'failed' | 'interrupted'; lastError: string; countHealth?: boolean };

export function markEffectAttempt(
  db: Db,
  id: string,
  fence: number,
  next: EffectAttemptOutcome,
): boolean {
  const base = {
    state: next.state,
    lastError: next.lastError.slice(0, 500),
    ...(next.state === 'pending' && next.countAttempt === false
      ? {}
      : { attempts: sql`${externalEffect.attempts} + 1` }),
    updatedAt: nowMs(),
    ...(next.state === 'pending' ? { dueAt: next.dueAt } : {}),
  };
  return (
    db
      .update(externalEffect)
      .set(base)
      .where(
        and(
          eq(externalEffect.id, id),
          eq(externalEffect.state, 'sending'),
          eq(externalEffect.claimFence, fence),
        ),
      )
      .run().changes > 0
  );
}

function settleSendError(err: unknown, attempts: number, now: number): EffectAttemptOutcome {
  if (err instanceof EffectWait) {
    return {
      state: 'pending',
      dueAt: now + (err.retryAfterMs ?? 0),
      lastError: err.message,
      countAttempt: false,
    };
  }
  if (err instanceof EffectFail || attempts + 1 >= EFFECT_MAX_ATTEMPTS) {
    return {
      state: 'failed' as const,
      lastError: err instanceof Error ? err.message : String(err),
      countHealth: !(err instanceof EffectFail) || err.countHealth,
    };
  }
  const retryAfter = err instanceof EffectRetry ? err.retryAfterMs : undefined;
  return {
    state: 'pending' as const,
    dueAt: now + (retryAfter ?? effectBackoffMs(attempts)),
    lastError: err instanceof Error ? err.message : String(err),
  };
}

export async function runEffectRow(
  db: Db,
  registry: EffectKindRegistry,
  id: string,
  now = nowMs(),
): Promise<'delivered' | 'skipped' | 'failed' | 'pending'> {
  const def = registry.get(
    db
      .select({ kind: externalEffect.kind })
      .from(externalEffect)
      .where(eq(externalEffect.id, id))
      .get()?.kind ?? '',
  );
  if (def?.send === undefined) return 'skipped';
  const claimed = claimEffect(db, id, now);
  if (claimed === null) return 'skipped';
  try {
    const receipt = await def.send(claimed, db);
    markEffectDelivered(db, id, claimed.claimFence ?? now, receipt ?? null);
    noteEffectHealth(db, claimed.kind, true);
    return 'delivered';
  } catch (err) {
    const next = settleSendError(err, claimed.attempts, nowMs());
    markEffectAttempt(db, id, claimed.claimFence ?? now, next);
    if ((next.state === 'pending' ? next.countAttempt : next.countHealth) !== false)
      noteEffectHealth(db, claimed.kind, false);
    return next.state === 'failed' ? 'failed' : 'pending';
  }
}

const drainsRunning = new WeakSet<Db>();

export const EFFECT_KIND_FAILURE_REPORT_AFTER = 3;

const kindFailures = new WeakMap<Db, Map<string, number>>();

function noteEffectHealth(db: Db, kind: string, ok: boolean) {
  let counts = kindFailures.get(db);
  if (counts === undefined) {
    counts = new Map();
    kindFailures.set(db, counts);
  }
  if (ok) {
    counts.delete(kind);
    return;
  }
  const failures = (counts.get(kind) ?? 0) + 1;
  counts.set(kind, failures);
  if (failures === EFFECT_KIND_FAILURE_REPORT_AFTER) {
    process.stderr.write(
      `EXTERNAL EFFECT KIND FAILING ${kind}: ${failures} consecutive failures\n`,
    );
  }
}

export async function drainEffects(
  db: Db,
  registry: EffectKindRegistry,
  opts: { now?: number; limit?: number } = {},
): Promise<void> {
  if (drainsRunning.has(db)) return;
  drainsRunning.add(db);
  try {
    const now = opts.now ?? nowMs();
    const rows = db
      .select()
      .from(externalEffect)
      .where(and(eq(externalEffect.state, 'pending'), lte(externalEffect.dueAt, now)))
      .orderBy(asc(externalEffect.createdAt), asc(externalEffect.id))
      .limit(opts.limit ?? 50)
      .all();
    for (const row of rows) {
      await runEffectRow(db, registry, row.id, nowMs());
    }
  } finally {
    drainsRunning.delete(db);
  }
}

export async function settleEffectRow(
  db: Db,
  registry: EffectKindRegistry,
  row: EffectRow,
  now = nowMs(),
): Promise<EffectRow> {
  const staleSending =
    row.state === 'sending' && (row.claimFence ?? 0) <= now - EFFECT_CLAIM_STALE_MS;
  if (row.state !== 'interrupted' && !staleSending) return row;
  const def = registry.get(row.kind);
  if (def?.policy === 'probe' && def.probe !== undefined) {
    const verdict = await def.probe(row).catch((): EffectProbeVerdict => ({ verdict: 'unknown' }));
    if (verdict.verdict === 'delivered') {
      db.update(externalEffect)
        .set({ state: 'delivered', receipt: verdict.receipt ?? null, updatedAt: nowMs() })
        .where(
          and(
            eq(externalEffect.id, row.id),
            inArray(externalEffect.state, ['interrupted', 'sending']),
          ),
        )
        .run();
      noteEffectHealth(db, row.kind, true);
    } else if (verdict.verdict === 'unsent') {
      db.update(externalEffect)
        .set({ state: 'pending', dueAt: now, updatedAt: nowMs() })
        .where(
          and(
            eq(externalEffect.id, row.id),
            inArray(externalEffect.state, ['interrupted', 'sending']),
          ),
        )
        .run();
    }
  } else if (def?.policy === 'replay-safe' && staleSending) {
    db.update(externalEffect)
      .set({ state: 'pending', dueAt: now, updatedAt: nowMs() })
      .where(and(eq(externalEffect.id, row.id), eq(externalEffect.state, 'sending')))
      .run();
  }
  return effectRow(db, row.id) ?? row;
}

export async function reconcileEffects(
  db: Db,
  registry: EffectKindRegistry,
  now = nowMs(),
): Promise<{ requeued: number; interrupted: number; cancelled: number; probed: number }> {
  const tally = { requeued: 0, interrupted: 0, cancelled: 0, probed: 0 };
  const stale = db
    .select()
    .from(externalEffect)
    .where(
      and(
        eq(externalEffect.state, 'sending'),
        lte(externalEffect.claimFence, now - EFFECT_CLAIM_STALE_MS),
      ),
    )
    .all();
  for (const row of stale) {
    if (!registry.has(row.kind)) continue;
    const settled = await settleEffectRow(db, registry, row, now);
    if (settled.state === 'delivered') {
      tally.probed += 1;
      continue;
    }
    if (settled.state === 'pending') {
      tally.requeued += 1;
      continue;
    }
    if (settled.state === 'sending') {
      db.update(externalEffect)
        .set({ state: 'interrupted', updatedAt: nowMs() })
        .where(and(eq(externalEffect.id, row.id), eq(externalEffect.state, 'sending')))
        .run();
      tally.interrupted += 1;
    }
  }
  const pending = db.select().from(externalEffect).where(eq(externalEffect.state, 'pending')).all();
  for (const row of pending) {
    const def = registry.get(row.kind);
    if (def === undefined) continue;
    let gone = false;
    try {
      gone = def.scopeGone?.(db, row) === true;
    } catch {
      gone = false;
    }
    if (gone) {
      db.update(externalEffect)
        .set({ state: 'cancelled', updatedAt: nowMs() })
        .where(and(eq(externalEffect.id, row.id), eq(externalEffect.state, 'pending')))
        .run();
      tally.cancelled += 1;
    }
  }
  return tally;
}

export function cancelScopeEffects(
  db: Db,
  scopeKind: EffectScopeKind,
  scopeId: string,
  kind?: string,
): number {
  return db
    .update(externalEffect)
    .set({ state: 'cancelled', updatedAt: nowMs() })
    .where(
      and(
        eq(externalEffect.state, 'pending'),
        eq(externalEffect.scopeKind, scopeKind),
        eq(externalEffect.scopeId, scopeId),
        ...(kind === undefined ? [] : [eq(externalEffect.kind, kind)]),
      ),
    )
    .run().changes;
}

export function effectRow(db: Db, id: string): EffectRow | undefined {
  return db.select().from(externalEffect).where(eq(externalEffect.id, id)).get();
}

export function interruptedEffectsForTodo(db: Db, todoId: string): EffectRow[] {
  const stepIds = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(eq(build.todoId, todoId))
    .all()
    .map((r) => r.id);
  return db
    .select()
    .from(externalEffect)
    .where(
      and(
        eq(externalEffect.state, 'interrupted'),
        stepIds.length === 0
          ? and(eq(externalEffect.scopeKind, 'todo'), eq(externalEffect.scopeId, todoId))
          : or(
              and(eq(externalEffect.scopeKind, 'todo'), eq(externalEffect.scopeId, todoId)),
              and(eq(externalEffect.scopeKind, 'step'), inArray(externalEffect.scopeId, stepIds)),
            ),
      ),
    )
    .orderBy(asc(externalEffect.createdAt), asc(externalEffect.id))
    .all();
}

export function interruptedEffectsNote(db: Db, todoId: string): string | null {
  const rows = interruptedEffectsForTodo(db, todoId);
  if (rows.length === 0) return null;
  const kinds = [...new Set(rows.map((r) => r.kind))].join(', ');
  return `External effect notice: ${rows.length} outward action(s) for this task (${kinds}) ended in an unknown state and were not retried. Report the uncertainty to the user instead of resending.`;
}

export function cancelPendingEffects(db: Db, where: SQLWrapper | undefined): number {
  return db
    .update(externalEffect)
    .set({ state: 'cancelled', updatedAt: nowMs() })
    .where(and(eq(externalEffect.state, 'pending'), where))
    .run().changes;
}

export function effectAttemptOutcome(
  err: unknown,
  attempts: number,
  now: number,
): EffectAttemptOutcome {
  return settleSendError(err, attempts, now);
}
