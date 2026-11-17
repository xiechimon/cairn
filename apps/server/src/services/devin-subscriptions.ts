import type {
  CreateDevinSubscription,
  DevinSubscription,
  DevinSubscriptionVerifyResult,
  SecretBox,
} from '@cairn/shared';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, devinSubscription, step, todo } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { verifyDevinSubscription } from './devin-subscription-verification.js';
import { subscriptionUsageStats } from './subscription-usage.js';

export type DevinAccountStepsPage = {
  steps: {
    stepId: string;
    kind: 'build' | 'plan' | 'chief' | 'review' | 'merge';
    threadId: string;
    todoId: string;
    title: string | null;
    startedAt: number;
    outcome: 'done' | 'failed' | 'running';
  }[];
  hasEarlier: boolean;
};

type Deps = { db: Db; box: SecretBox };
type Row = typeof devinSubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();

function toRecord(row: Row): DevinSubscription {
  return {
    id: row.id,
    kind: 'devin-subscription',
    label: row.label,
    expiresAt: row.expiresAt,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    createdAt: row.createdAt,
  };
}

function subscriptionRow(db: Pick<Db, 'select'>, teamId: string, id: string): Row | undefined {
  return db
    .select()
    .from(devinSubscription)
    .where(and(eq(devinSubscription.teamId, teamId), eq(devinSubscription.id, id)))
    .get();
}

function enabledRow(db: Pick<Db, 'select'>, teamId: string): Row | undefined {
  return db
    .select()
    .from(devinSubscription)
    .where(and(eq(devinSubscription.teamId, teamId), isNotNull(devinSubscription.enabledAt)))
    .get();
}

function runningStepCount(db: Pick<Db, 'select'>, subscriptionId: string): number {
  return (
    db
      .select({ n: count() })
      .from(step)
      .where(and(eq(step.status, 'claimed'), eq(step.devinSubscriptionId, subscriptionId)))
      .get()?.n ?? 0
  );
}

function refuseWhileRunning(db: Pick<Db, 'select'>, row: Row, action: string): void {
  if (row.enabledAt === null) return;
  const running = runningStepCount(db, row.id);
  if (running > 0) {
    throw new HttpError(
      409,
      `Cannot ${action} this account while ${running} task(s) are running on it; finish or stop them first.`,
      undefined,
      { code: 'running-tasks', running },
    );
  }
}

export function renameDevinSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  label: string,
): DevinSubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  if (label.includes(deps.box.open(row.tokenCipher))) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  deps.db.update(devinSubscription).set({ label }).where(eq(devinSubscription.id, id)).run();
  return toRecord({ ...row, label });
}

export async function enableDevinSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<DevinSubscription> {
  const target = subscriptionRow(deps.db, teamId, id);
  if (!target) throw notFound('Devin subscription connection');
  if (target.expiresAt !== null && target.expiresAt <= nowMs()) {
    throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
  }
  if (target.enabledAt !== null) return toRecord(target);
  const enabledBefore = enabledRow(deps.db, teamId)?.id ?? null;
  const verified = await verifyDevinSubscription(deps.box.open(target.tokenCipher)).catch(
    (): DevinSubscriptionVerifyResult => ({ ok: false, reason: 'failed' }),
  );
  if (!verified.ok) {
    throw new HttpError(
      409,
      'The new account did not pass verification; the current account stays enabled.',
      verified.reason ?? 'failed',
      { code: 'precheck-failed' },
    );
  }
  const now = nowMs();
  try {
    return deps.db.transaction((tx) => {
      const fresh = subscriptionRow(tx, teamId, id);
      if (!fresh) throw notFound('Devin subscription connection');
      if (fresh.expiresAt !== null && fresh.expiresAt <= now) {
        throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
      }
      if (fresh.enabledAt !== null) return toRecord(fresh);
      const current = enabledRow(tx, teamId);
      if ((current?.id ?? null) !== enabledBefore) {
        throw new HttpError(
          409,
          'The enabled account changed while verifying; try again.',
          undefined,
          {
            code: 'conflict',
          },
        );
      }
      if (current) {
        refuseWhileRunning(tx, current, 'switch away from');
        tx.update(devinSubscription)
          .set({ enabledAt: null })
          .where(eq(devinSubscription.id, current.id))
          .run();
      }
      tx.update(devinSubscription)
        .set({ enabledAt: now })
        .where(eq(devinSubscription.id, id))
        .run();
      return toRecord({ ...fresh, enabledAt: now });
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw new HttpError(409, 'The enabled account changed; try again.', undefined, {
        code: 'conflict',
      });
    }
    throw error;
  }
}

export function disableDevinSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): DevinSubscription {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) throw notFound('Devin subscription connection');
    if (row.enabledAt === null) return toRecord(row);
    refuseWhileRunning(tx, row, 'disable');
    tx.update(devinSubscription).set({ enabledAt: null }).where(eq(devinSubscription.id, id)).run();
    return toRecord({ ...row, enabledAt: null });
  });
}

const STEP_KINDS_SHOWN = ['build', 'plan', 'chief', 'review', 'merge'] as const;

export function listDevinSubscriptionSteps(
  deps: { db: Db },
  teamId: string,
  id: string,
  limit: number,
): DevinAccountStepsPage {
  if (!subscriptionRow(deps.db, teamId, id)) throw notFound('Devin subscription connection');
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo, threadRow: chiefThread })
    .from(step)
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(step.devinSubscriptionId, id),
        isNotNull(step.claimedAt),
        inArray(step.status, ['claimed', 'done', 'failed', 'stopped']),
      ),
    )
    .orderBy(desc(step.claimedAt), desc(step.id))
    .limit(limit + 1)
    .all();
  return {
    steps: rows.slice(0, limit).map(({ stepRow, todoRow, threadRow }) => ({
      stepId: stepRow.id,
      kind: STEP_KINDS_SHOWN.find((kind) => kind === stepRow.kind) ?? 'build',
      threadId: stepRow.buildId,
      todoId: todoRow?.id ?? '',
      title: todoRow?.title ?? threadRow?.title ?? null,
      startedAt: stepRow.claimedAt ?? stepRow.createdAt,
      outcome:
        stepRow.status === 'claimed' ? 'running' : stepRow.status === 'done' ? 'done' : 'failed',
    })),
    hasEarlier: rows.length > limit,
  };
}

export interface DevinSubscriptionListEntry extends DevinSubscription {
  lastUsedAt?: number | null;
  stepsLast24h?: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function listDevinSubscriptions(deps: Deps, teamId: string): DevinSubscriptionListEntry[] {
  const rows = deps.db
    .select()
    .from(devinSubscription)
    .where(eq(devinSubscription.teamId, teamId))
    .orderBy(desc(devinSubscription.createdAt), desc(devinSubscription.id))
    .all();
  const usage = subscriptionUsageStats(
    deps.db,
    step.devinSubscriptionId,
    rows.map((row) => row.id),
    nowMs() - DAY_MS,
  );
  return rows.map((row) => {
    const stats = usage.get(row.id);
    return {
      ...toRecord(row),
      lastUsedAt: stats?.lastUsedAt ?? null,
      stepsLast24h: stats?.stepsLast24h ?? null,
    };
  });
}

export function createDevinSubscription(
  deps: Deps,
  teamId: string,
  body: CreateDevinSubscription,
): DevinSubscription {
  if (body.label.includes(body.token))
    throw new HttpError(400, 'Connection label must not contain the token');
  const now = nowMs();
  const row = {
    id: newRecordId(),
    teamId,
    label: body.label,
    tokenCipher: deps.box.seal(body.token),
    expiresAt: body.expiresAt ?? null,
    enabledAt: null as number | null,
    createdAt: now,
  };
  deps.db.transaction((tx) => {
    tx.update(devinSubscription)
      .set({ enabledAt: null })
      .where(
        and(
          eq(devinSubscription.teamId, teamId),
          isNotNull(devinSubscription.enabledAt),
          isNotNull(devinSubscription.expiresAt),
          lte(devinSubscription.expiresAt, now),
        ),
      )
      .run();
    row.enabledAt = activeSubscriptionRow({ db: tx }, teamId) === undefined ? now : null;
    tx.insert(devinSubscription).values(row).run();
  });
  return toRecord(row);
}

export async function verifyDevinSubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<DevinSubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(devinSubscription)
    .where(and(eq(devinSubscription.teamId, teamId), eq(devinSubscription.id, id)))
    .get();
  if (!row) throw notFound('Devin subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return { ok: false };
  const now = nowMs();
  const windows = verificationWindows.get(deps.db) ?? new Map<string, number>();
  for (const [connectionId, retryAt] of windows) {
    if (retryAt <= now) windows.delete(connectionId);
  }
  if (windows.has(row.id)) {
    throw new HttpError(
      429,
      'Please wait 10 seconds between verification attempts for this connection.',
    );
  }
  windows.set(row.id, now + 10_000);
  verificationWindows.set(deps.db, windows);
  try {
    return await verifyDevinSubscription(deps.box.open(row.tokenCipher));
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function openDevinSubscription(
  deps: Deps,
  teamId: string,
  provider: string | null | undefined,
  boundSubscriptionId: string | null | undefined,
): string | undefined {
  if (provider !== 'devin' || !boundSubscriptionId) return undefined;
  const row = deps.db
    .select()
    .from(devinSubscription)
    .where(
      and(
        eq(devinSubscription.teamId, teamId),
        eq(devinSubscription.id, boundSubscriptionId),
        or(isNull(devinSubscription.expiresAt), gt(devinSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
  return row ? deps.box.open(row.tokenCipher) : undefined;
}

export function enabledDevinSubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): string | null {
  return activeSubscriptionRow(deps, teamId)?.id ?? null;
}

export function hasActiveDevinSubscription(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): boolean {
  return activeSubscriptionRow(deps, teamId) !== undefined;
}

function activeSubscriptionRow(deps: { db: Pick<Db, 'select'> }, teamId: string): Row | undefined {
  return deps.db
    .select()
    .from(devinSubscription)
    .where(
      and(
        eq(devinSubscription.teamId, teamId),
        isNotNull(devinSubscription.enabledAt),
        or(isNull(devinSubscription.expiresAt), gt(devinSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
}

export function deleteDevinSubscription(deps: { db: Db }, teamId: string, id: string): boolean {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) return false;
    refuseWhileRunning(tx, row, 'delete');
    return (
      tx
        .delete(devinSubscription)
        .where(and(eq(devinSubscription.teamId, teamId), eq(devinSubscription.id, id)))
        .run().changes > 0
    );
  });
}
