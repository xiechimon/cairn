import type {
  AntigravitySubscription,
  AntigravitySubscriptionListEntry,
  AntigravitySubscriptionVerifyResult,
  CreateAntigravitySubscription,
  SecretBox,
} from '@cairn/shared';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { antigravitySubscription, build, chiefThread, machine, step, todo } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  verifyAntigravityHostLogin,
  verifyAntigravitySubscription,
} from './antigravity-subscription-verification.js';
import { subscriptionUsageStats } from './subscription-usage.js';

export type AntigravityAccountStepsPage = {
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
type Row = typeof antigravitySubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();

function toRecord(row: Row): AntigravitySubscription {
  return {
    id: row.id,
    kind: 'antigravity-subscription',
    label: row.label,
    hasToken: row.tokenCipher !== null,
    expiresAt: row.expiresAt,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    createdAt: row.createdAt,
  };
}

function subscriptionRow(db: Pick<Db, 'select'>, teamId: string, id: string): Row | undefined {
  return db
    .select()
    .from(antigravitySubscription)
    .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
    .get();
}

function enabledRow(db: Pick<Db, 'select'>, teamId: string): Row | undefined {
  return db
    .select()
    .from(antigravitySubscription)
    .where(
      and(eq(antigravitySubscription.teamId, teamId), isNotNull(antigravitySubscription.enabledAt)),
    )
    .get();
}

function runningStepCount(db: Pick<Db, 'select'>, subscriptionId: string): number {
  return (
    db
      .select({ n: count() })
      .from(step)
      .where(and(eq(step.status, 'claimed'), eq(step.antigravitySubscriptionId, subscriptionId)))
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

async function verifyRowCredentials(
  deps: Deps,
  teamId: string,
  row: Row,
): Promise<AntigravitySubscriptionVerifyResult> {
  if (row.tokenCipher !== null) {
    return verifyAntigravitySubscription(deps.box.open(row.tokenCipher)).catch(
      (): AntigravitySubscriptionVerifyResult => ({ ok: false, reason: 'failed' }),
    );
  }
  const onlineMachines = deps.db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true)))
    .all();
  const agReports = onlineMachines
    .map((m) => m.capabilities?.antigravity)
    .filter((report): report is NonNullable<typeof report> => report !== undefined);
  if (agReports.some((report) => report.installed && report.authenticated === true)) {
    return { ok: true };
  }
  if (agReports.some((report) => report.installed)) {
    return { ok: false, reason: 'missing_local_login' };
  }
  if (onlineMachines.length > 0) {
    return { ok: false, reason: 'unavailable' };
  }
  return verifyAntigravityHostLogin().catch(
    (): AntigravitySubscriptionVerifyResult => ({ ok: false, reason: 'failed' }),
  );
}

export function renameAntigravitySubscription(
  deps: Deps,
  teamId: string,
  id: string,
  label: string,
): AntigravitySubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Antigravity subscription connection');
  if (row.tokenCipher !== null && label.includes(deps.box.open(row.tokenCipher))) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  deps.db
    .update(antigravitySubscription)
    .set({ label })
    .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
    .run();
  return toRecord({ ...row, label });
}

export async function enableAntigravitySubscription(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<AntigravitySubscription> {
  const target = subscriptionRow(deps.db, teamId, id);
  if (!target) throw notFound('Antigravity subscription connection');
  if (target.expiresAt !== null && target.expiresAt <= nowMs()) {
    throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
  }
  if (target.enabledAt !== null) return toRecord(target);
  const enabledBefore = enabledRow(deps.db, teamId)?.id ?? null;
  const verified = await verifyRowCredentials(deps, teamId, target);
  if (!verified.ok) {
    throw new HttpError(
      409,
      'The new account did not pass verification; the current account stays enabled.',
      verified.reason ?? 'failed',
      { code: 'precheck-failed' },
    );
  }
  const enabledAt = nowMs();
  try {
    return deps.db.transaction((tx) => {
      const fresh = subscriptionRow(tx, teamId, id);
      if (!fresh) throw notFound('Antigravity subscription connection');
      if (fresh.enabledAt !== null) return toRecord(fresh);
      const current = enabledRow(tx, teamId);
      if ((current?.id ?? null) !== enabledBefore) {
        throw new HttpError(409, 'The enabled account changed; try again.', undefined, {
          code: 'conflict',
        });
      }
      if (current) {
        refuseWhileRunning(tx, current, 'switch away from');
        tx.update(antigravitySubscription)
          .set({ enabledAt: null })
          .where(
            and(
              eq(antigravitySubscription.teamId, teamId),
              eq(antigravitySubscription.id, current.id),
            ),
          )
          .run();
      }
      tx.update(antigravitySubscription)
        .set({ enabledAt })
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run();
      return toRecord({ ...fresh, enabledAt });
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

export function disableAntigravitySubscription(
  deps: Deps,
  teamId: string,
  id: string,
): AntigravitySubscription {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) throw notFound('Antigravity subscription connection');
    if (row.enabledAt === null) return toRecord(row);
    refuseWhileRunning(tx, row, 'disable');
    tx.update(antigravitySubscription)
      .set({ enabledAt: null })
      .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
      .run();
    return toRecord({ ...row, enabledAt: null });
  });
}

const STEP_KINDS_SHOWN = ['build', 'plan', 'chief', 'review', 'merge'] as const;

export function listAntigravitySubscriptionSteps(
  deps: { db: Db },
  teamId: string,
  id: string,
  limit: number,
): AntigravityAccountStepsPage {
  if (!subscriptionRow(deps.db, teamId, id)) {
    throw notFound('Antigravity subscription connection');
  }
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo, threadRow: chiefThread })
    .from(step)
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(step.antigravitySubscriptionId, id),
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

const DAY_MS = 24 * 60 * 60 * 1000;

export function listAntigravitySubscriptions(
  deps: Deps,
  teamId: string,
): AntigravitySubscriptionListEntry[] {
  const rows = deps.db
    .select()
    .from(antigravitySubscription)
    .where(eq(antigravitySubscription.teamId, teamId))
    .orderBy(desc(antigravitySubscription.createdAt), desc(antigravitySubscription.id))
    .all();
  const usage = subscriptionUsageStats(
    deps.db,
    step.antigravitySubscriptionId,
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

export function createAntigravitySubscription(
  deps: Deps,
  teamId: string,
  body: CreateAntigravitySubscription,
): AntigravitySubscription {
  const token = body.token ?? null;
  if (token !== null && body.label.includes(token)) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  const now = nowMs();
  const row: Row = {
    id: newRecordId(),
    teamId,
    label: body.label,
    tokenCipher: token !== null ? deps.box.seal(token) : null,
    expiresAt: body.expiresAt ?? null,
    enabledAt: null,
    createdAt: now,
  };
  return deps.db.transaction((tx) => {
    tx.update(antigravitySubscription)
      .set({ enabledAt: null })
      .where(
        and(
          eq(antigravitySubscription.teamId, teamId),
          isNotNull(antigravitySubscription.enabledAt),
          isNotNull(antigravitySubscription.expiresAt),
          lte(antigravitySubscription.expiresAt, now),
        ),
      )
      .run();
    const shouldEnable =
      enabledRow(tx, teamId) === undefined && (row.expiresAt === null || row.expiresAt > now);
    const stored = shouldEnable ? { ...row, enabledAt: now } : row;
    tx.insert(antigravitySubscription).values(stored).run();
    return toRecord(stored);
  });
}

export async function verifyAntigravitySubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<AntigravitySubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(antigravitySubscription)
    .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
    .get();
  if (!row) throw notFound('Antigravity subscription connection');
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
  return verifyRowCredentials(deps, teamId, row);
}

export function openAntigravitySubscription(
  deps: Deps,
  teamId: string,
  provider: string | null | undefined,
  boundSubscriptionId: string | null | undefined,
): string | undefined {
  if (provider !== 'antigravity' || !boundSubscriptionId) return undefined;
  const row = deps.db
    .select()
    .from(antigravitySubscription)
    .where(
      and(
        eq(antigravitySubscription.teamId, teamId),
        eq(antigravitySubscription.id, boundSubscriptionId),
        or(
          isNull(antigravitySubscription.expiresAt),
          gt(antigravitySubscription.expiresAt, nowMs()),
        ),
      ),
    )
    .get();
  if (row === undefined || row.tokenCipher === null) return undefined;
  return deps.box.open(row.tokenCipher);
}

export function enabledAntigravitySubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): string | null {
  return activeSubscriptionRow(deps, teamId)?.id ?? null;
}

export function activeAntigravitySubscriptionMode(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): 'none' | 'host' | 'token' {
  const row = activeSubscriptionRow(deps, teamId);
  if (row === undefined) return 'none';
  return row.tokenCipher !== null ? 'token' : 'host';
}

export function hasActiveAntigravitySubscription(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): boolean {
  return activeSubscriptionRow(deps, teamId) !== undefined;
}

function activeSubscriptionRow(deps: { db: Pick<Db, 'select'> }, teamId: string): Row | undefined {
  return deps.db
    .select()
    .from(antigravitySubscription)
    .where(
      and(
        eq(antigravitySubscription.teamId, teamId),
        isNotNull(antigravitySubscription.enabledAt),
        or(
          isNull(antigravitySubscription.expiresAt),
          gt(antigravitySubscription.expiresAt, nowMs()),
        ),
      ),
    )
    .get();
}

export function deleteAntigravitySubscription(
  deps: { db: Db },
  teamId: string,
  id: string,
): boolean {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) return false;
    refuseWhileRunning(tx, row, 'delete');
    return (
      tx
        .delete(antigravitySubscription)
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run().changes > 0
    );
  });
}
