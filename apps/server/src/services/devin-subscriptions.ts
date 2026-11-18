import type {
  CreateDevinSubscription,
  DevinSubscription,
  DevinSubscriptionListEntry,
  DevinSubscriptionVerifyResult,
  PatchDevinSubscription,
  ProviderFailure,
  SecretBox,
  UpstreamModelsResult,
} from '@cairn/shared';
import { and, count, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { devinSubscription, step } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { fetchDevinSubscriptionModels } from './devin-subscription-models.js';
import { verifyDevinSubscription } from './devin-subscription-verification.js';
import { subscriptionUsageStats } from './subscription-usage.js';

type Deps = { db: Db; box: SecretBox };
type Row = typeof devinSubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();
const upstreamModelsWindows = new WeakMap<Db, Map<string, number>>();

function claimRateWindow(
  store: WeakMap<Db, Map<string, number>>,
  db: Db,
  connectionId: string,
  action: string,
): void {
  const now = nowMs();
  const windows = store.get(db) ?? new Map<string, number>();
  for (const [id, retryAt] of windows) {
    if (retryAt <= now) windows.delete(id);
  }
  if (windows.has(connectionId)) {
    throw new HttpError(429, `Please wait 10 seconds between ${action} for this connection.`);
  }
  windows.set(connectionId, now + 10_000);
  store.set(db, windows);
}

function toRecord(row: Row): DevinSubscription {
  return {
    id: row.id,
    kind: 'devin-subscription',
    label: row.label,
    expiresAt: row.expiresAt,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    models: row.models,
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

export function updateDevinSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  patch: PatchDevinSubscription,
): DevinSubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  if (patch.label?.includes(deps.box.open(row.tokenCipher))) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  let models: Row['models'] | undefined;
  if (patch.models !== undefined) {
    const seen = new Set<string>();
    models = patch.models.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }
  deps.db
    .update(devinSubscription)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(models !== undefined ? { models } : {}),
    })
    .where(eq(devinSubscription.id, id))
    .run();
  return toRecord({
    ...row,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(models !== undefined ? { models } : {}),
  });
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
    models: [] as Row['models'],
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
  claimRateWindow(verificationWindows, deps.db, row.id, 'verification attempts');
  try {
    return await verifyDevinSubscription(deps.box.open(row.tokenCipher));
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const UPSTREAM_MODELS_FAILURE: Record<
  'auth' | 'timeout' | 'unavailable' | 'failed',
  ProviderFailure
> = {
  auth: 'auth',
  timeout: 'timeout',
  unavailable: 'upstream',
  failed: 'upstream',
};

export async function devinSubscriptionUpstreamModels(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<UpstreamModelsResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) {
    return { status: 'failed', failure: 'auth', httpStatus: null };
  }
  claimRateWindow(upstreamModelsWindows, deps.db, row.id, 'model list attempts');
  const harvested = await fetchDevinSubscriptionModels(deps.box.open(row.tokenCipher)).catch(
    () => ({ ok: false as const, reason: 'failed' as const }),
  );
  if (!harvested.ok) {
    return {
      status: 'failed',
      failure: UPSTREAM_MODELS_FAILURE[harvested.reason],
      httpStatus: null,
    };
  }
  return { status: 'ok', models: harvested.models };
}

export function enabledDevinSubscriptionModels(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): { id: string; name: string }[] {
  return (activeSubscriptionRow(deps, teamId)?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name,
  }));
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
