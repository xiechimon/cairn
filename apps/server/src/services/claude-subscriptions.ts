import type {
  ClaudeSubscription,
  ClaudeSubscriptionVerifyResult,
  CreateClaudeSubscription,
  SecretBox,
} from '@cairn/shared';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, claudeSubscription, machine, step, todo } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { verifyClaudeSubscription } from './claude-subscription-verification.js';

export type AccountStepsPage = {
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
type Row = typeof claudeSubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();

function toRecord(row: Row): ClaudeSubscription {
  return {
    id: row.id,
    kind: 'claude-subscription',
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
    .from(claudeSubscription)
    .where(and(eq(claudeSubscription.teamId, teamId), eq(claudeSubscription.id, id)))
    .get();
}

function enabledRow(db: Pick<Db, 'select'>, teamId: string): Row | undefined {
  return db
    .select()
    .from(claudeSubscription)
    .where(and(eq(claudeSubscription.teamId, teamId), isNotNull(claudeSubscription.enabledAt)))
    .get();
}

function runningStepCount(db: Pick<Db, 'select'>, subscriptionId: string): number {
  return (
    db
      .select({ n: count() })
      .from(step)
      .where(and(eq(step.status, 'claimed'), eq(step.claudeSubscriptionId, subscriptionId)))
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

export function renameClaudeSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  label: string,
): ClaudeSubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Claude subscription connection');
  if (label.includes(deps.box.open(row.tokenCipher))) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  deps.db.update(claudeSubscription).set({ label }).where(eq(claudeSubscription.id, id)).run();
  return toRecord({ ...row, label });
}

export async function enableClaudeSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<ClaudeSubscription> {
  const target = subscriptionRow(deps.db, teamId, id);
  if (!target) throw notFound('Claude subscription connection');
  if (target.expiresAt !== null && target.expiresAt <= nowMs()) {
    throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
  }
  if (target.enabledAt !== null) return toRecord(target);
  const enabledBefore = enabledRow(deps.db, teamId)?.id ?? null;
  const verified = await verifyClaudeSubscription(deps.box.open(target.tokenCipher)).catch(
    (): ClaudeSubscriptionVerifyResult => ({ ok: false, reason: 'failed' }),
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
      if (!fresh) throw notFound('Claude subscription connection');
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
        tx.update(claudeSubscription)
          .set({ enabledAt: null })
          .where(eq(claudeSubscription.id, current.id))
          .run();
      }
      tx.update(claudeSubscription)
        .set({ enabledAt: now })
        .where(eq(claudeSubscription.id, id))
        .run();
      tx.update(machine).set({ claudeRateLimits: null }).where(eq(machine.teamId, teamId)).run();
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

export function disableClaudeSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): ClaudeSubscription {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) throw notFound('Claude subscription connection');
    if (row.enabledAt === null) return toRecord(row);
    refuseWhileRunning(tx, row, 'disable');
    tx.update(claudeSubscription)
      .set({ enabledAt: null })
      .where(eq(claudeSubscription.id, id))
      .run();
    return toRecord({ ...row, enabledAt: null });
  });
}

const STEP_KINDS_SHOWN = ['build', 'plan', 'chief', 'review', 'merge'] as const;

export function listSubscriptionSteps(
  deps: { db: Db },
  teamId: string,
  id: string,
  limit: number,
): AccountStepsPage {
  if (!subscriptionRow(deps.db, teamId, id)) throw notFound('Claude subscription connection');
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo, threadRow: chiefThread })
    .from(step)
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(step.claudeSubscriptionId, id),
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

export function listClaudeSubscriptions(deps: Deps, teamId: string): ClaudeSubscription[] {
  return deps.db
    .select()
    .from(claudeSubscription)
    .where(eq(claudeSubscription.teamId, teamId))
    .orderBy(desc(claudeSubscription.createdAt), desc(claudeSubscription.id))
    .all()
    .map(toRecord);
}

export function createClaudeSubscription(
  deps: Deps,
  teamId: string,
  body: CreateClaudeSubscription,
): ClaudeSubscription {
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
    tx.update(claudeSubscription)
      .set({ enabledAt: null })
      .where(
        and(
          eq(claudeSubscription.teamId, teamId),
          isNotNull(claudeSubscription.enabledAt),
          isNotNull(claudeSubscription.expiresAt),
          lte(claudeSubscription.expiresAt, now),
        ),
      )
      .run();
    row.enabledAt = activeSubscriptionRow({ db: tx }, teamId) === undefined ? now : null;
    tx.insert(claudeSubscription).values(row).run();
  });
  return toRecord(row);
}

export async function verifySubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<ClaudeSubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(claudeSubscription)
    .where(and(eq(claudeSubscription.teamId, teamId), eq(claudeSubscription.id, id)))
    .get();
  if (!row) throw notFound('Claude subscription connection');
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
    return await verifyClaudeSubscription(deps.box.open(row.tokenCipher));
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function openClaudeSubscription(
  deps: Deps,
  teamId: string,
  provider: string | null | undefined,
  boundSubscriptionId: string | null | undefined,
): string | undefined {
  if (provider !== 'claude-code' || !boundSubscriptionId) return undefined;
  const row = deps.db
    .select()
    .from(claudeSubscription)
    .where(
      and(
        eq(claudeSubscription.teamId, teamId),
        eq(claudeSubscription.id, boundSubscriptionId),
        or(isNull(claudeSubscription.expiresAt), gt(claudeSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
  return row ? deps.box.open(row.tokenCipher) : undefined;
}

export function enabledSubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): string | null {
  return activeSubscriptionRow(deps, teamId)?.id ?? null;
}

export function hasActiveClaudeSubscription(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): boolean {
  return activeSubscriptionRow(deps, teamId) !== undefined;
}

function activeSubscriptionRow(deps: { db: Pick<Db, 'select'> }, teamId: string): Row | undefined {
  return deps.db
    .select()
    .from(claudeSubscription)
    .where(
      and(
        eq(claudeSubscription.teamId, teamId),
        isNotNull(claudeSubscription.enabledAt),
        or(isNull(claudeSubscription.expiresAt), gt(claudeSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
}

export function deleteClaudeSubscription(deps: { db: Db }, teamId: string, id: string): boolean {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) return false;
    refuseWhileRunning(tx, row, 'delete');
    return (
      tx
        .delete(claudeSubscription)
        .where(and(eq(claudeSubscription.teamId, teamId), eq(claudeSubscription.id, id)))
        .run().changes > 0
    );
  });
}
