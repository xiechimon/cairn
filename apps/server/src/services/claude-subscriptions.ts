import type {
  ClaudeRateLimitNotice,
  ClaudeRateLimitWindow,
  ClaudeSubscription,
  ClaudeSubscriptionListEntry,
  ClaudeSubscriptionModel,
  ClaudeSubscriptionQuotaWindow,
  ClaudeSubscriptionVerifyResult,
  CreateClaudeSubscription,
  PatchClaudeSubscription,
  ProviderFailure,
  ProviderTestResult,
  SecretBox,
  UpstreamModelsResult,
} from '@cairn/shared';
import {
  applyClaudeRateLimit,
  CLAUDE_MODEL_ID_PATTERN,
  CLAUDE_RATE_LIMIT_UNSPECIFIED,
  canonicalClaudeModels,
  claudeRateBlock,
  DEFAULT_CLAUDE_CODE_MODELS,
} from '@cairn/shared';
import { and, count, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claudeSubscription, machine, step } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  CLAUDE_CHECK_COMMAND,
  CLAUDE_MODEL_TEST_COMMAND,
  fetchClaudeUsageWindows,
  probeClaudeQuota,
  probeClaudeSubscriptionModel,
  verifyClaudeSubscription,
} from './claude-subscription-verification.js';
import { timedCheck } from './subscription-check.js';
import { subscriptionUsageStats } from './subscription-usage.js';
import { fetchAnthropicOAuthModels } from './upstream-models.js';

type Deps = { db: Db; box: SecretBox };
type UpstreamDeps = Deps & { fetch?: typeof globalThis.fetch; timeoutMs?: number };

const UPSTREAM_TIMEOUT_MS = 10_000;

function savedModels(models: ClaudeSubscriptionModel[] | null): ClaudeSubscriptionModel[] | null {
  if (models === null) return null;
  return canonicalClaudeModels(models.filter((model) => CLAUDE_MODEL_ID_PATTERN.test(model.id)));
}
type Row = typeof claudeSubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();
const modelTestWindows = new WeakMap<Db, Map<string, number>>();

function claimRateWindow(
  store: WeakMap<Db, Map<string, number>>,
  db: Db,
  key: string,
  action: string,
  windowMs = 10_000,
): void {
  const now = nowMs();
  const windows = store.get(db) ?? new Map<string, number>();
  for (const [id, retryAt] of windows) {
    if (retryAt <= now) windows.delete(id);
  }
  if (windows.has(key)) {
    throw new HttpError(
      429,
      `Please wait ${windowMs / 1000} seconds between ${action} for this connection.`,
    );
  }
  windows.set(key, now + windowMs);
  store.set(db, windows);
}

function toRecord(row: Row): ClaudeSubscription {
  return {
    id: row.id,
    kind: 'claude-subscription',
    label: row.label,
    expiresAt: row.expiresAt,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    models: savedModels(row.models),
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

export function updateClaudeSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  patch: PatchClaudeSubscription,
): ClaudeSubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Claude subscription connection');
  const token = deps.box.open(row.tokenCipher);
  if (patch.label?.includes(token)) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  if (patch.models?.some((model) => model.id.includes(token) || model.name.includes(token))) {
    throw new HttpError(400, 'Model names must not contain the token');
  }
  const models =
    patch.models === undefined || patch.models === null
      ? patch.models
      : canonicalClaudeModels(patch.models);
  const changes = {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(models !== undefined ? { models } : {}),
  };
  deps.db.update(claudeSubscription).set(changes).where(eq(claudeSubscription.id, id)).run();
  return toRecord({ ...row, ...changes });
}

function fallbackClaudeModels(deps: Deps, teamId: string): { id: string; name: string }[] {
  const reported = deps.db
    .select({ report: machine.claudeCodeReport })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .flatMap((row) => (row.report?.installed ? row.report.models : []));
  return canonicalClaudeModels([...DEFAULT_CLAUDE_CODE_MODELS, ...reported]).map(
    ({ id, name }) => ({ id, name }),
  );
}

export async function claudeSubscriptionUpstreamModels(
  deps: UpstreamDeps,
  teamId: string,
  id: string,
): Promise<UpstreamModelsResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Claude subscription connection');
  const fallback = (failure: ProviderFailure, httpStatus: number | null): UpstreamModelsResult => ({
    status: 'fallback',
    failure,
    httpStatus,
    models: fallbackClaudeModels(deps, teamId),
  });
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return fallback('auth', null);
  let token: string;
  try {
    token = deps.box.open(row.tokenCipher);
  } catch {
    return fallback('auth', null);
  }
  const listed = await fetchAnthropicOAuthModels({
    oauthToken: token,
    fetch: deps.fetch ?? globalThis.fetch,
    timeoutMs: deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS,
  });
  if (!listed.ok) return fallback(listed.failure, listed.httpStatus);
  if (listed.models.length === 0) return fallback('no-model', null);
  return { status: 'ok', models: listed.models };
}

export function enabledClaudeSubscriptionModels(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): ClaudeSubscriptionModel[] | null {
  return savedModels(activeSubscriptionRow(deps, teamId)?.models ?? null);
}

export async function enableClaudeSubscription(
  deps: UpstreamDeps,
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
  const verified = await verifyClaudeSubscription(deps.box.open(target.tokenCipher), {
    fetch: deps.fetch,
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  }).catch((): ClaudeSubscriptionVerifyResult => ({ ok: false, reason: 'failed' }));
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

const DAY_MS = 24 * 60 * 60 * 1000;

function quotaWindowWire(
  window: ClaudeRateLimitWindow,
  now: number,
): ClaudeSubscriptionQuotaWindow | null {
  if (window.utilization === null) return null;
  if (window.resetsAt !== null && window.resetsAt <= now) return null;
  return {
    name: window.subscription,
    utilization: window.utilization,
    resetsAt: window.resetsAt,
    observedAt: window.reportedAt,
  };
}

export function listClaudeSubscriptions(deps: Deps, teamId: string): ClaudeSubscriptionListEntry[] {
  const rows = deps.db
    .select()
    .from(claudeSubscription)
    .where(eq(claudeSubscription.teamId, teamId))
    .orderBy(desc(claudeSubscription.createdAt), desc(claudeSubscription.id))
    .all();
  const now = nowMs();
  const usage = subscriptionUsageStats(
    deps.db,
    step.claudeSubscriptionId,
    rows.map((row) => row.id),
    now - DAY_MS,
  );
  return rows.map((row) => {
    const stored = row.quotaWindows ?? [];
    const block = claudeRateBlock(stored, now);
    const stats = usage.get(row.id);
    return {
      ...toRecord(row),
      windows: stored
        .map((window) => quotaWindowWire(window, now))
        .filter((window) => window !== null),
      lastCheck: row.lastCheck,
      ...(block !== null ? { state: 'exhausted' as const, cooldownUntil: block.until } : {}),
      lastUsedAt: stats?.lastUsedAt ?? null,
      stepsLast24h: stats?.stepsLast24h ?? null,
    };
  });
}

export const CLAUDE_QUOTA_REFRESH_MS = 60_000;
const QUOTA_PROBED_WINDOWS = ['five_hour', 'seven_day'];

const quotaProbes = new WeakMap<Db, Map<string, { at: number; done: Promise<void> }>>();
const usageEndpointRefusals = new WeakMap<Db, Set<string>>();

function quotaFresh(row: Row, now: number): boolean {
  const windows = row.quotaWindows ?? [];
  return QUOTA_PROBED_WINDOWS.every((name) => {
    const window = windows.find((entry) => entry.subscription === name);
    return window !== undefined && now - window.reportedAt < CLAUDE_QUOTA_REFRESH_MS;
  });
}

async function probeAndStoreQuota(deps: UpstreamDeps, row: Row): Promise<void> {
  let token: string;
  try {
    token = deps.box.open(row.tokenCipher);
  } catch {
    return;
  }
  const options = { fetch: deps.fetch, timeoutMs: deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS };
  const refused = usageEndpointRefusals.get(deps.db) ?? new Set<string>();
  usageEndpointRefusals.set(deps.db, refused);
  let notices: ClaudeRateLimitNotice[] | null = null;
  if (!refused.has(row.id)) {
    const usage = await fetchClaudeUsageWindows(token, options);
    if (usage.status === 'ok') notices = usage.notices;
    else if (usage.status === 'unsupported') refused.add(row.id);
  }
  if (notices === null) {
    const tried = new Set<string>();
    let refusedAll = false;
    let done = false;
    for (const source of [
      () => Promise.resolve((savedModels(row.models) ?? []).map((entry) => entry.id)),
      async () => {
        const listed = await fetchAnthropicOAuthModels({
          oauthToken: token,
          fetch: options.fetch ?? globalThis.fetch,
          timeoutMs: options.timeoutMs,
        });
        if (!listed.ok) return [];
        const ids = listed.models.map((entry) => entry.id);
        return [
          ...ids.filter((id) => id.startsWith('claude-haiku')),
          ...ids.filter((id) => !id.startsWith('claude-haiku')),
        ];
      },
    ]) {
      for (const candidate of (await source()).filter((id) => !tried.has(id)).slice(0, 3)) {
        tried.add(candidate);
        const probe = await probeClaudeQuota(token, candidate, options);
        if (probe.notices.length > 0) {
          notices = probe.notices;
          done = true;
          break;
        }
        if (probe.status === 429) {
          refusedAll = true;
          continue;
        }
        done = true;
        break;
      }
      if (done) break;
    }
    if (notices === null && refusedAll) notices = [{ status: 'rejected' }];
  }
  if (notices === null || notices.length === 0) return;
  const now = nowMs();
  const current = subscriptionRow(deps.db, row.teamId, row.id);
  if (current === undefined) return;
  const windows = notices.reduce(
    (stored, notice) => applyClaudeRateLimit(stored, notice, now),
    current.quotaWindows ?? [],
  );
  const named = notices.some((notice) => notice.rateLimitType !== undefined);
  deps.db
    .update(claudeSubscription)
    .set({
      quotaWindows: named
        ? windows.filter(
            (window) =>
              window.subscription !== CLAUDE_RATE_LIMIT_UNSPECIFIED || window.status !== 'rejected',
          )
        : windows,
    })
    .where(eq(claudeSubscription.id, row.id))
    .run();
}

export async function refreshClaudeQuota(
  deps: UpstreamDeps,
  teamId: string,
): Promise<ClaudeSubscriptionListEntry[]> {
  const row = enabledRow(deps.db, teamId);
  const now = nowMs();
  if (
    row !== undefined &&
    (row.expiresAt === null || row.expiresAt > now) &&
    !quotaFresh(row, now)
  ) {
    const probes =
      quotaProbes.get(deps.db) ?? new Map<string, { at: number; done: Promise<void> }>();
    quotaProbes.set(deps.db, probes);
    const last = probes.get(row.id);
    if (last === undefined || now - last.at >= CLAUDE_QUOTA_REFRESH_MS) {
      const done = probeAndStoreQuota(deps, row).catch(() => undefined);
      probes.set(row.id, { at: now, done });
      await done;
    } else {
      await last.done;
    }
  }
  return listClaudeSubscriptions(deps, teamId);
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
    quotaWindows: null,
    models: null,
    lastCheck: null,
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
  deps: UpstreamDeps,
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
  claimRateWindow(verificationWindows, deps.db, row.id, 'verification attempts');
  const result = await timedCheck(
    () =>
      Promise.resolve()
        .then(() =>
          verifyClaudeSubscription(deps.box.open(row.tokenCipher), {
            fetch: deps.fetch,
            ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
          }),
        )
        .catch((): ClaudeSubscriptionVerifyResult => ({ ok: false, reason: 'failed' })),
    { check: 'sign-in', command: CLAUDE_CHECK_COMMAND, model: null },
  );
  deps.db
    .update(claudeSubscription)
    .set({ lastCheck: result.check })
    .where(eq(claudeSubscription.id, row.id))
    .run();
  return result;
}

const TEST_FAILURE: Record<
  NonNullable<ClaudeSubscriptionVerifyResult['reason']>,
  ProviderFailure
> = {
  auth: 'auth',
  timeout: 'timeout',
  quota: 'rate-limit',
  unavailable: 'upstream',
  failed: 'upstream',
};

export async function testClaudeSubscriptionModel(
  deps: UpstreamDeps,
  teamId: string,
  id: string,
  model: string,
): Promise<ProviderTestResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Claude subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) {
    return {
      status: 'failed',
      reason: 'auth',
      failure: 'auth',
      httpStatus: null,
      detail: null,
      latencyMs: null,
    };
  }
  const known = await claudeSubscriptionUpstreamModels(deps, teamId, id);
  if (known.status === 'failed' || !known.models.some((entry) => entry.id === model)) {
    throw new HttpError(400, 'Unknown model for this subscription');
  }
  claimRateWindow(modelTestWindows, deps.db, `${row.id}:${model}`, 'tests of this model', 30_000);
  const result = await timedCheck(
    () =>
      Promise.resolve()
        .then(() =>
          probeClaudeSubscriptionModel(deps.box.open(row.tokenCipher), model, {
            fetch: deps.fetch,
            ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
          }),
        )
        .catch((): ClaudeSubscriptionVerifyResult => ({ ok: false, reason: 'failed' })),
    { check: 'model-request', command: CLAUDE_MODEL_TEST_COMMAND, model },
  );
  return result.ok
    ? {
        status: 'ok',
        reason: null,
        failure: null,
        httpStatus: null,
        detail: null,
        latencyMs: result.check.durationMs,
      }
    : {
        status: 'failed',
        reason: result.reason ?? 'failed',
        failure: TEST_FAILURE[result.reason ?? 'failed'],
        httpStatus: null,
        detail: null,
        latencyMs: null,
      };
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
