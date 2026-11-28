import type {
  CreateDevinSubscription,
  DevinSubscription,
  DevinSubscriptionListEntry,
  DevinSubscriptionModel,
  DevinSubscriptionVerifyResult,
  PatchDevinSubscription,
  ProviderFailure,
  ProviderTestResult,
  SecretBox,
  UpstreamModelsResult,
} from '@cairn/shared';
import {
  DEFAULT_DEVIN_MODELS,
  devinCatalogFamilies,
  devinSweVariant,
  devinWireModel,
  isRegisteredMachine,
} from '@cairn/shared';
import { and, count, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { devinSubscription, machine, step, stepSubscription } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  type DevinSubscriptionModelsResult,
  fetchDevinSubscriptionModels,
} from './devin-subscription-models.js';
import { verifyDevinSubscription } from './devin-subscription-verification.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { timedCheck } from './subscription-check.js';
import {
  assertLabelHidesToken,
  claimRateWindow,
  dedupeSubscriptionModels,
  refuseWhileRunning,
} from './subscription-helpers.js';
import { modelTurnFailure, runSubscriptionModelTurn } from './subscription-model-turn.js';
import { subscriptionUsageStats } from './subscription-usage.js';

type Deps = { db: Db; box: SecretBox };
type Row = typeof devinSubscription.$inferSelect;

type CachedModels = {
  result: Extract<DevinSubscriptionModelsResult, { ok: true }>;
  freshUntil: number;
  staleUntil: number;
};

type ModelCacheEntry = {
  generation: number;
  tokenCipher: Row['tokenCipher'];
  retryAt: number;
  value?: CachedModels;
  pending?: Promise<DevinSubscriptionModelsResult>;
};

const MODELS_TTL_MS = 60_000;
const MODELS_MAX_AGE_MS = 300_000;
const MODELS_RETRY_MS = 10_000;
const verificationWindows = new WeakMap<Db, Map<string, number>>();
const upstreamModelsCache = new WeakMap<Db, Map<string, ModelCacheEntry>>();

function invalidateUpstreamModels(db: Db, id: string): void {
  const entry = upstreamModelsCache.get(db)?.get(id);
  if (entry === undefined) return;
  entry.generation += 1;
  entry.value = undefined;
  if (!entry.pending) entry.retryAt = 0;
}

function toRecord(row: Row): DevinSubscription {
  return {
    id: row.id,
    kind: 'devin-subscription',
    label: row.label,
    expiresAt: row.expiresAt,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    models: devinCatalogFamilies(row.models),
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
      .leftJoin(stepSubscription, eq(stepSubscription.stepId, step.id))
      .where(
        and(eq(step.status, 'claimed'), eq(stepSubscription.devinSubscriptionId, subscriptionId)),
      )
      .get()?.n ?? 0
  );
}

export function updateDevinSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  patch: PatchDevinSubscription,
): DevinSubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  assertLabelHidesToken(patch.label, deps.box.open(row.tokenCipher));
  const models =
    patch.models === undefined
      ? undefined
      : dedupeSubscriptionModels(
          patch.models.flatMap((model) => {
            const id = devinWireModel('devin', model.id, model.thinkingDefault) ?? model.id;
            if (id === model.id) return [model];
            const previous = row.models.filter(
              (entry) => devinSweVariant(entry.id)?.baseId === model.id,
            );
            return previous.some((entry) => entry.id === id) ? previous : [{ ...model, id }];
          }),
        );
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
    invalidateUpstreamModels(deps.db, target.id);
    throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
  }
  if (target.enabledAt !== null) return toRecord(target);
  const enabledBefore = enabledRow(deps.db, teamId)?.id ?? null;
  const verified = await verifyDevinSubscription(deps.box.open(target.tokenCipher)).catch(
    (): DevinSubscriptionVerifyResult => ({ ok: false, reason: 'failed' }),
  );
  if (!verified.ok) {
    invalidateUpstreamModels(deps.db, target.id);
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
        if (current.enabledAt !== null) {
          refuseWhileRunning(() => runningStepCount(tx, current.id), 'switch away from');
        }
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
    refuseWhileRunning(() => runningStepCount(tx, row.id), 'disable');
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
    stepSubscription.devinSubscriptionId,
    rows.map((row) => row.id),
    nowMs() - DAY_MS,
  );
  return rows.map((row) => {
    const stats = usage.get(row.id);
    return {
      ...toRecord(row),
      lastUsedAt: stats?.lastUsedAt ?? null,
      stepsLast24h: stats?.stepsLast24h ?? null,
      lastCheck: row.lastCheck,
    };
  });
}

export function createDevinSubscription(
  deps: Deps,
  teamId: string,
  body: CreateDevinSubscription,
): DevinSubscription {
  assertLabelHidesToken(body.label, body.token);
  const now = nowMs();
  const row = {
    id: newRecordId(),
    teamId,
    label: body.label,
    tokenCipher: deps.box.seal(body.token),
    expiresAt: body.expiresAt ?? null,
    enabledAt: null as number | null,
    models: [] as Row['models'],
    lastCheck: null,
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
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) {
    invalidateUpstreamModels(deps.db, row.id);
    return { ok: false, reason: 'auth' };
  }
  claimRateWindow(verificationWindows, deps.db, row.id, 'verification attempts');
  const result = await timedCheck(
    () =>
      Promise.resolve()
        .then(() => verifyDevinSubscription(deps.box.open(row.tokenCipher)))
        .catch((): DevinSubscriptionVerifyResult => ({ ok: false, reason: 'failed' })),
    { check: 'sign-in', command: 'devin acp · authenticate', via: 'cli', model: null },
  );
  if (!result.ok) invalidateUpstreamModels(deps.db, row.id);
  deps.db
    .update(devinSubscription)
    .set({ lastCheck: result.check })
    .where(eq(devinSubscription.id, row.id))
    .run();
  return result;
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

function refreshUpstreamModels(
  deps: Deps,
  row: Row,
  entry: ModelCacheEntry,
): Promise<DevinSubscriptionModelsResult> {
  const generation = entry.generation;
  entry.retryAt = nowMs() + MODELS_RETRY_MS;
  entry.pending = Promise.resolve()
    .then(() => fetchDevinSubscriptionModels(deps.box.open(row.tokenCipher)))
    .catch((): DevinSubscriptionModelsResult => ({ ok: false, reason: 'failed' }))
    .then((result): DevinSubscriptionModelsResult => {
      if (entry.generation !== generation) return { ok: false, reason: 'auth' };
      if (result.ok) {
        const now = nowMs();
        entry.value = {
          result,
          freshUntil: now + MODELS_TTL_MS,
          staleUntil: now + MODELS_MAX_AGE_MS,
        };
      } else if (result.reason === 'auth') {
        delete entry.value;
      }
      return result;
    })
    .finally(() => {
      delete entry.pending;
    });
  return entry.pending;
}

async function cachedUpstreamModels(deps: Deps, row: Row): Promise<DevinSubscriptionModelsResult> {
  const now = nowMs();
  const cache = upstreamModelsCache.get(deps.db) ?? new Map<string, ModelCacheEntry>();
  upstreamModelsCache.set(deps.db, cache);
  for (const [id, entry] of cache) {
    if (!entry.pending && entry.retryAt <= now && (entry.value?.staleUntil ?? 0) <= now) {
      cache.delete(id);
    }
  }
  let entry = cache.get(row.id);
  if (entry === undefined) {
    entry = { generation: 0, tokenCipher: row.tokenCipher, retryAt: 0 };
    cache.set(row.id, entry);
  } else if (entry.tokenCipher !== row.tokenCipher) {
    invalidateUpstreamModels(deps.db, row.id);
    entry.tokenCipher = row.tokenCipher;
  }
  const value = entry.value;
  if (value && now < value.staleUntil) {
    if (now >= value.freshUntil && !entry.pending && now >= entry.retryAt) {
      void refreshUpstreamModels(deps, row, entry);
    }
    return value.result;
  }
  if (entry.pending) return entry.pending;
  if (now < entry.retryAt) {
    throw new HttpError(
      429,
      'Please wait 10 seconds between model list attempts for this connection.',
    );
  }
  return refreshUpstreamModels(deps, row, entry);
}

export async function devinSubscriptionUpstreamModels(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<UpstreamModelsResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) {
    invalidateUpstreamModels(deps.db, row.id);
    return { status: 'failed', failure: 'auth', httpStatus: null };
  }
  const harvested = await cachedUpstreamModels(deps, row);
  if (!harvested.ok) {
    return {
      status: 'failed',
      failure: UPSTREAM_MODELS_FAILURE[harvested.reason],
      httpStatus: null,
    };
  }
  return { status: 'ok', models: harvested.models };
}

export async function testDevinSubscriptionModel(
  deps: Deps & { machineHub: MachineWakeHub },
  teamId: string,
  id: string,
  model: string,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Devin subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return modelTurnFailure('auth');
  const runners = () =>
    deps.db
      .select()
      .from(machine)
      .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt), eq(machine.online, true)))
      .all();
  const eligible = (runner: typeof machine.$inferSelect) =>
    isRegisteredMachine(runner) &&
    runner.capabilities?.modelTurnProbe === true &&
    runner.capabilities.devin?.installed === true;
  const current = runners();
  const catalog = devinCatalogFamilies(
    row.models.length > 0
      ? row.models
      : [
          ...current.flatMap((runner) => runner.capabilities?.devin?.models ?? []),
          ...DEFAULT_DEVIN_MODELS,
        ],
  );
  const selected = catalog.find((entry) => entry.id === (devinSweVariant(model)?.baseId ?? model));
  if (!selected) throw new HttpError(400, 'Unknown model for this subscription');
  const variant = devinSweVariant(model);
  const wire =
    devinWireModel('devin', model, variant === null ? selected.thinkingDefault : null) ?? model;
  return runSubscriptionModelTurn(
    deps.db,
    deps.machineHub,
    id,
    wire,
    current.filter(eligible).map((r) => r.id),
    () => ({ mode: 'devin', model: wire, token: deps.box.open(row.tokenCipher) }),
    (machineId) => {
      const fresh = subscriptionRow(deps.db, teamId, id);
      return (
        fresh !== undefined &&
        fresh.tokenCipher === row.tokenCipher &&
        (fresh.expiresAt === null || fresh.expiresAt > nowMs()) &&
        runners().some((r) => r.id === machineId && eligible(r))
      );
    },
    signal,
  );
}

export function enabledDevinSubscriptionModels(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): Pick<DevinSubscriptionModel, 'id' | 'name' | 'thinkingLevels' | 'thinkingDefault'>[] {
  return (activeSubscriptionRow(deps, teamId)?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.thinkingLevels !== undefined ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.thinkingDefault !== undefined ? { thinkingDefault: model.thinkingDefault } : {}),
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
  const removed = deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) return false;
    if (row.enabledAt !== null) refuseWhileRunning(() => runningStepCount(tx, row.id), 'delete');
    return (
      tx
        .delete(devinSubscription)
        .where(and(eq(devinSubscription.teamId, teamId), eq(devinSubscription.id, id)))
        .run().changes > 0
    );
  });
  if (removed) invalidateUpstreamModels(deps.db, id);
  return removed;
}
