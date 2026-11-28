import type {
  AntigravityOAuthStepCredential,
  AntigravityRunnerLogin,
  AntigravitySubscription,
  AntigravitySubscriptionListEntry,
  AntigravitySubscriptionModel,
  AntigravitySubscriptionVerifyResult,
  ClaudeSubscriptionQuotaWindow,
  CreateAntigravitySubscription,
  MachineAntigravityUsageProbeClaim,
  MachineCapabilities,
  PatchAntigravitySubscription,
  ProviderFailure,
  SecretBox,
  UpstreamModelsResult,
} from '@cairn/shared';
import {
  ANTIGRAVITY_REFRESH_TOKEN_REGEX,
  antigravityOAuthAuthMethodSchema,
  antigravityOAuthStepCredentialSchema,
  DEFAULT_ANTIGRAVITY_MODELS,
  isAntigravityOAuthAccessToken,
  isInternalAntigravityModelId,
  isRegisteredMachine,
} from '@cairn/shared';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { antigravitySubscription, build, chiefThread, machine, step, todo } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  antigravityProbedCatalog,
  fetchAntigravityEntitlements,
} from './antigravity-entitlements.js';
import { dispatchAntigravityModelProbe } from './antigravity-model-probes.js';
import {
  probeAntigravityOAuth,
  probeAntigravityOAuthAccessToken,
  refreshAntigravityOAuthAccessToken,
  verifyAntigravitySubscription,
} from './antigravity-subscription-verification.js';
import { dispatchAntigravityUsageProbe } from './antigravity-usage-probes.js';
import { requestAntigravityVerify } from './machine-antigravity-verify.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { timedCheck } from './subscription-check.js';
import {
  assertLabelHidesToken,
  claimRateWindow,
  dedupeSubscriptionModels,
  refuseWhileRunning,
} from './subscription-helpers.js';
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

type Deps = {
  db: Db;
  box: SecretBox;
  dataDir?: string;
  machineHub?: MachineWakeHub;
  verifyTimeoutMs?: number;
};
type Row = typeof antigravitySubscription.$inferSelect;
type RunnerDb = Pick<Db, 'select' | 'update'>;
type Runner = Pick<
  typeof machine.$inferSelect,
  'id' | 'name' | 'online' | 'kind' | 'lastSeenAt' | 'capabilities'
>;
const runnerColumns = {
  id: machine.id,
  name: machine.name,
  online: machine.online,
  kind: machine.kind,
  lastSeenAt: machine.lastSeenAt,
  capabilities: machine.capabilities,
};

const verificationWindows = new WeakMap<Db, Map<string, number>>();
const activeVerifications = new WeakMap<Db, Set<string>>();
const upstreamModelsWindows = new WeakMap<Db, Map<string, number>>();
const quotaProbes = new WeakMap<
  Db,
  Map<string, { at: number; pending: boolean; done: Promise<void> }>
>();
export const ANTIGRAVITY_QUOTA_REFRESH_MS = 60_000;
export const ANTIGRAVITY_QUOTA_FRESH_MS = 5 * 60_000;
export const ANTIGRAVITY_QUOTA_POLL_MS = 5 * 60_000;
const OAUTH_CIPHER_PREFIX = 'oauth-personal:';
const BOUND_OAUTH_CIPHER_PREFIX = `${OAUTH_CIPHER_PREFIX}v2:`;
const googleSubjectSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/);
const boundOAuthSchema = z.object({
  token: z.string().refine(isAntigravityOAuthAccessToken),
  tokenExpiresAt: z.number().int().positive().max(8_640_000_000_000_000).optional(),
  refreshToken: z.string().regex(ANTIGRAVITY_REFRESH_TOKEN_REGEX).optional(),
  authMethod: antigravityOAuthAuthMethodSchema.optional(),
  subject: googleSubjectSchema,
});
const googleTokenInfoSchema = z.object({
  expires_in: z.union([z.number(), z.string().regex(/^-?\d+$/)]),
  sub: googleSubjectSchema,
});

type BoundOAuth = z.infer<typeof boundOAuthSchema>;
type ResolvedSubscription = CreateAntigravitySubscription & {
  googleSubject?: string;
  tokenExpiresAt?: number;
  models?: AntigravitySubscriptionModel[];
};

function defaultSeedModels(): AntigravitySubscriptionModel[] {
  return DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name }));
}

function openBoundOAuth(box: SecretBox, cipher: string): BoundOAuth {
  try {
    return boundOAuthSchema.parse(
      JSON.parse(box.open(cipher.slice(BOUND_OAUTH_CIPHER_PREFIX.length))),
    );
  } catch {
    throw new Error('Unable to open the saved Antigravity OAuth credential.');
  }
}

function sealBoundOAuth(box: SecretBox, payload: BoundOAuth): string {
  return `${BOUND_OAUTH_CIPHER_PREFIX}${box.seal(JSON.stringify(payload))}`;
}

type LegacyOrBoundOAuth = {
  token: string;
  tokenExpiresAt?: number;
  refreshToken?: string;
  authMethod?: z.infer<typeof antigravityOAuthAuthMethodSchema>;
  subject?: string;
};

function openStoredOAuth(box: SecretBox, cipher: string): LegacyOrBoundOAuth {
  if (cipher.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) return openBoundOAuth(box, cipher);
  return { token: box.open(cipher.slice(OAUTH_CIPHER_PREFIX.length)) };
}

function secretValuesOfCipher(box: SecretBox, cipher: string): string[] {
  if (cipher.startsWith(OAUTH_CIPHER_PREFIX)) {
    const oauth = openStoredOAuth(box, cipher);
    return [oauth.token, oauth.refreshToken].filter(
      (value): value is string => value !== undefined && value.length > 0,
    );
  }
  return [box.open(cipher)];
}

function isRefreshOAuthRow(box: SecretBox, cipher: string | null): boolean {
  if (cipher === null || !cipher.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) return false;
  try {
    return openBoundOAuth(box, cipher).refreshToken !== undefined;
  } catch {
    return false;
  }
}

function toRecord(row: Row): AntigravitySubscription {
  return {
    id: row.id,
    kind: 'antigravity-subscription',
    label: row.label,
    hasToken: row.tokenCipher !== null,
    ...(row.tokenCipher?.startsWith(OAUTH_CIPHER_PREFIX) ? { oauthPersonal: true as const } : {}),
    ...(row.tokenCipher === null ? { runnerId: row.runnerId } : {}),
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

function registeredRunners(db: Pick<Db, 'select'>, teamId: string): Runner[] {
  return db
    .select(runnerColumns)
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .orderBy(asc(machine.name), asc(machine.id))
    .all()
    .filter(isRegisteredMachine);
}

function runnerLoginStatus(runner: Runner): AntigravityRunnerLogin['status'] {
  const report = runner.capabilities?.antigravity;
  if (!runner.online || report?.installed !== true) return 'unavailable';
  return report.authenticated === true ? 'ok' : 'missing_local_login';
}

function teamRunnerLogins(db: Pick<Db, 'select'>, teamId: string): AntigravityRunnerLogin[] {
  return registeredRunners(db, teamId).map((runner) => ({
    runnerId: runner.id,
    name: runner.name,
    online: runner.online,
    status: runnerLoginStatus(runner),
  }));
}

function subscriptionRunner(
  db: Pick<Db, 'select'>,
  teamId: string,
  id?: string,
): Runner | undefined {
  if (id !== undefined) {
    return db
      .select(runnerColumns)
      .from(machine)
      .where(and(eq(machine.teamId, teamId), eq(machine.id, id), isNull(machine.retiredAt)))
      .get();
  }
  const registered = registeredRunners(db, teamId);
  return registered.length === 1 ? registered[0] : undefined;
}

function bindRunner(db: RunnerDb, row: Row, runnerId: string): string | null {
  const pinned = db
    .update(antigravitySubscription)
    .set({ runnerId })
    .where(
      and(
        eq(antigravitySubscription.teamId, row.teamId),
        eq(antigravitySubscription.id, row.id),
        isNull(antigravitySubscription.tokenCipher),
        isNull(antigravitySubscription.runnerId),
      ),
    )
    .run();
  return pinned.changes === 1
    ? runnerId
    : (subscriptionRow(db, row.teamId, row.id)?.runnerId ?? null);
}

function resolveBoundRunner(db: Pick<Db, 'select'>, row: Row) {
  const sole = row.runnerId === null ? subscriptionRunner(db, row.teamId) : undefined;
  const runnerId = row.runnerId ?? sole?.id ?? null;
  const runner =
    sole !== undefined
      ? sole
      : runnerId === null
        ? undefined
        : subscriptionRunner(db, row.teamId, runnerId);
  return { runnerId, runner };
}

function runnerLogin(db: Pick<Db, 'select'>, row: Row) {
  const { runnerId, runner } = resolveBoundRunner(db, row);
  const report = runner?.capabilities?.antigravity;
  if (runner === undefined || !runner.online || report?.installed !== true) {
    return {
      status: 'unavailable',
      runnerId,
      hostname: runner?.name ?? null,
      offline: runnerId !== null && runner?.online !== true,
    } as const;
  }
  if (report.authenticated !== true) {
    return { status: 'missing_local_login', runnerId, hostname: runner.name } as const;
  }
  return {
    status: 'ok',
    runnerId: runner.id,
    hostname: runner.name,
    models: report.models ?? [],
  } as const;
}
type VerifiedCredentials = AntigravitySubscriptionVerifyResult & {
  reportedDurationMs?: number;
  command: string;
  via: 'cli' | 'api';
  seededModels?: AntigravitySubscriptionModel[];
};

async function verifyRowCredentials(
  deps: Deps,
  row: Row,
  signal?: AbortSignal,
  ownerInitiated = true,
): Promise<VerifiedCredentials> {
  if (row.tokenCipher !== null) {
    const cipher = row.tokenCipher;
    return Promise.resolve()
      .then(async (): Promise<VerifiedCredentials> => {
        if (!cipher.startsWith(OAUTH_CIPHER_PREFIX)) {
          const result = await verifyAntigravitySubscription(deps.box.open(cipher));
          return {
            ...result,
            command: 'Antigravity account API',
            via: 'api',
            ...(result.ok ? { seededModels: defaultSeedModels() } : {}),
          };
        }
        const stored = openStoredOAuth(deps.box, cipher);
        if (stored.refreshToken !== undefined) {
          const probed = await probeAntigravityOAuth(
            {
              refreshToken: stored.refreshToken,
              authMethod: stored.authMethod ?? 'consumer',
            },
            { dataDir: deps.dataDir, signal },
          );
          return {
            ...probed.result,
            command: 'agy acp · Portable Google OAuth',
            via: 'cli',
            ...(probed.result.ok
              ? { seededModels: probed.models.length > 0 ? probed.models : defaultSeedModels() }
              : {}),
          };
        }
        if (row.expiresAt === null || row.expiresAt <= nowMs()) {
          return {
            ok: false,
            reason: 'auth',
            command: 'Antigravity account API',
            via: 'api',
          };
        }
        if (ownerInitiated) {
          const probed = await probeAntigravityOAuthAccessToken(
            { token: stored.token, expiresAt: row.expiresAt },
            { dataDir: deps.dataDir, signal },
          );
          if (probed.result.ok) {
            return {
              ok: true,
              command: 'agy acp · Google OAuth',
              via: 'cli',
              seededModels: probed.models.length > 0 ? probed.models : defaultSeedModels(),
            };
          }
          if (probed.result.reason !== 'unavailable') {
            return {
              ...probed.result,
              command: 'agy acp · Google OAuth',
              via: 'cli',
            };
          }
        }
        const result = await fetchAntigravityEntitlements(stored.token, signal);
        if (result.status === 'ok') {
          return {
            ok: true,
            command: 'Antigravity account API',
            via: 'api',
            seededModels: result.models,
          };
        }
        return {
          ok: false,
          reason:
            result.failure === 'auth' || result.failure === 'timeout' ? result.failure : 'failed',
          command: 'Antigravity account API',
          via: 'api',
        };
      })
      .catch(
        (): VerifiedCredentials => ({
          ok: false,
          reason: 'failed',
          command: 'Antigravity account API',
          via: 'api',
        }),
      );
  }
  const { runner } = resolveBoundRunner(deps.db, row);
  if (runner === undefined) {
    return {
      ok: false,
      reason: 'unavailable',
      command: 'agy acp · Runner sign-in',
      via: 'cli',
    };
  }
  const runnerName = runner.name;
  const command = `agy acp · ${runnerName}`;
  if (!runner.online || deps.machineHub === undefined) {
    return { ok: false, reason: 'unavailable', runnerName, command, via: 'cli' };
  }
  const outcome = await requestAntigravityVerify({ machineHub: deps.machineHub }, runner.id, {
    ...(deps.verifyTimeoutMs === undefined ? {} : { timeoutMs: deps.verifyTimeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    ok: outcome.ok,
    ...(outcome.ok ? {} : { reason: outcome.reason }),
    runnerName,
    command,
    via: 'cli',
    ...(outcome.durationMs !== undefined ? { reportedDurationMs: outcome.durationMs } : {}),
  };
}

export function patchAntigravitySubscription(
  deps: Deps,
  teamId: string,
  id: string,
  patch: PatchAntigravitySubscription,
): AntigravitySubscription {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Antigravity subscription connection');
  if (row.tokenCipher !== null) {
    for (const secret of secretValuesOfCipher(deps.box, row.tokenCipher)) {
      assertLabelHidesToken(patch.label, secret);
    }
  }
  const models =
    patch.models === undefined ? undefined : dedupeSubscriptionModels(patch.models, true);
  const updated = deps.db.transaction((tx) => {
    let runnerId = row.runnerId;
    if (row.tokenCipher === null && runnerId === null && patch.runnerId !== undefined) {
      const runner = subscriptionRunner(tx, teamId, patch.runnerId);
      if (!runner) throw notFound('Runner');
      runnerId = bindRunner(tx, row, runner.id);
    }
    const changes = {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(models !== undefined ? { models } : {}),
    };
    if (Object.keys(changes).length > 0) {
      tx.update(antigravitySubscription)
        .set(changes)
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run();
    }
    return toRecord({ ...row, ...changes, runnerId });
  });
  if (row.runnerId === null && updated.runnerId != null) {
    verificationWindows.get(deps.db)?.delete(id);
    upstreamModelsWindows.get(deps.db)?.delete(id);
    quotaProbes.get(deps.db)?.delete(id);
  }
  return updated;
}

export async function enableAntigravitySubscription(
  deps: Deps,
  teamId: string,
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AntigravitySubscription> {
  const target = subscriptionRow(deps.db, teamId, id);
  if (!target) throw notFound('Antigravity subscription connection');
  if (target.expiresAt !== null && target.expiresAt <= nowMs()) {
    throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
  }
  if (target.enabledAt !== null) return toRecord(target);
  const enabledBefore = enabledRow(deps.db, teamId)?.id ?? null;
  const verified = await verifyRowCredentials(deps, target, opts.signal);
  if (opts.signal?.aborted || !verified.ok) {
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
      if (fresh.expiresAt !== null && fresh.expiresAt <= enabledAt) {
        throw new HttpError(409, 'This token has expired.', undefined, { code: 'expired' });
      }
      if (fresh.tokenCipher !== target.tokenCipher || fresh.runnerId !== target.runnerId) {
        throw new HttpError(409, 'This subscription changed; try again.', undefined, {
          code: 'conflict',
        });
      }
      if (fresh.enabledAt !== null) return toRecord(fresh);
      const current = enabledRow(tx, teamId);
      if ((current?.id ?? null) !== enabledBefore) {
        throw new HttpError(409, 'The enabled account changed; try again.', undefined, {
          code: 'conflict',
        });
      }
      if (current) {
        refuseWhileRunning(() => runningStepCount(tx, current.id), 'switch away from');
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
      const seeded =
        fresh.tokenCipher !== null &&
        fresh.models.length === 0 &&
        verified.seededModels !== undefined &&
        verified.seededModels.length > 0
          ? dedupeSubscriptionModels(verified.seededModels, true)
          : undefined;
      tx.update(antigravitySubscription)
        .set({ enabledAt, ...(seeded !== undefined ? { models: seeded } : {}) })
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run();
      return toRecord({ ...fresh, enabledAt, ...(seeded !== undefined ? { models: seeded } : {}) });
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
    refuseWhileRunning(() => runningStepCount(tx, row.id), 'disable');
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

function quotaWindowWire(
  window: ClaudeSubscriptionQuotaWindow,
  now: number,
): ClaudeSubscriptionQuotaWindow | null {
  if (window.resetsAt !== null && window.resetsAt <= now) return null;
  return window;
}

export function listAntigravitySubscriptions(
  deps: Pick<Deps, 'db'>,
  teamId: string,
): AntigravitySubscriptionListEntry[] {
  const rows = deps.db
    .select()
    .from(antigravitySubscription)
    .where(eq(antigravitySubscription.teamId, teamId))
    .orderBy(desc(antigravitySubscription.createdAt), desc(antigravitySubscription.id))
    .all();
  const now = nowMs();
  const usage = subscriptionUsageStats(
    deps.db,
    step.antigravitySubscriptionId,
    rows.map((row) => row.id),
    now - DAY_MS,
  );
  const runnerLogins = teamRunnerLogins(deps.db, teamId);
  return rows.map((row) => {
    const stats = usage.get(row.id);
    const login = row.tokenCipher === null ? runnerLogin(deps.db, row) : undefined;
    const runnerModels =
      login?.status === 'ok' ? login.models.map(({ id, name }) => ({ id, name })) : [];
    const models =
      login === undefined
        ? row.models
        : row.models.filter((model) => runnerModels.some((entry) => entry.id === model.id));
    const windows = (row.quotaWindows ?? [])
      .map((window) => quotaWindowWire(window, now))
      .filter((window) => window !== null);
    return {
      ...toRecord(login === undefined ? row : { ...row, runnerId: login.runnerId, models }),
      windows,
      ...(login !== undefined
        ? { runnerName: login.hostname, runnerLogin: login.status, runnerModels, runnerLogins }
        : {}),
      ...(login?.status === 'unavailable' && login.offline ? { runnerOffline: true } : {}),
      lastUsedAt: stats?.lastUsedAt ?? null,
      stepsLast24h: stats?.stepsLast24h ?? null,
      lastCheck: row.lastCheck,
    };
  });
}

async function resolveGoogleOAuth(token: string, suppliedExpiry?: number | null) {
  const startedAt = nowMs();
  try {
    const response = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if ([400, 401, 403].includes(response.status)) {
      throw new HttpError(400, 'Google OAuth access token is invalid or expired.');
    }
    if (!response.ok) throw new HttpError(502, 'Unable to verify the Google OAuth account.');
    const info = googleTokenInfoSchema.parse(await response.json());
    const seconds = Number(info.expires_in);
    const googleExpiry = startedAt + seconds * 1000;
    if (
      !Number.isSafeInteger(seconds) ||
      !antigravityOAuthStepCredentialSchema.safeParse({
        kind: 'oauth-personal',
        token,
        expiresAt: googleExpiry,
      }).success
    ) {
      if (Number.isSafeInteger(seconds) && seconds <= 0) {
        throw new HttpError(400, 'Google OAuth access token is invalid or expired.');
      }
      throw new HttpError(502, 'Unable to verify the Google OAuth account.');
    }
    const expiresAt = Math.min(googleExpiry, suppliedExpiry ?? googleExpiry);
    if (expiresAt <= nowMs()) {
      throw new HttpError(400, 'Google OAuth access token is invalid or expired.');
    }
    return { expiresAt, googleSubject: info.sub };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Unable to verify the Google OAuth account.');
  }
}

async function resolveGoogleRefreshOAuth(
  input: {
    refreshToken: string;
    authMethod?: z.infer<typeof antigravityOAuthAuthMethodSchema>;
    token?: string | null;
    expiresAt?: number | null;
  },
  options: { dataDir?: string; signal?: AbortSignal } = {},
): Promise<{
  token: string;
  tokenExpiresAt: number;
  googleSubject: string;
  models: AntigravitySubscriptionModel[];
}> {
  const refreshed = await refreshAntigravityOAuthAccessToken(
    {
      refreshToken: input.refreshToken,
      authMethod: input.authMethod ?? 'consumer',
    },
    options,
  );
  if (refreshed.status === 'failed') {
    if (refreshed.failure === 'auth') {
      throw new HttpError(400, 'Google OAuth refresh token is invalid or expired.');
    }
    throw new HttpError(502, 'Unable to verify the Google OAuth account.');
  }
  const resolvedFromRefresh = await resolveGoogleOAuth(refreshed.token);
  if (input.token != null) {
    if (!isAntigravityOAuthAccessToken(input.token)) {
      throw new HttpError(400, 'Cannot combine a Gemini API key with a Google OAuth refresh token');
    }
    const resolvedSupplied = await resolveGoogleOAuth(input.token, input.expiresAt);
    if (resolvedSupplied.googleSubject !== resolvedFromRefresh.googleSubject) {
      throw new HttpError(
        400,
        'Google OAuth access token and refresh token belong to different accounts.',
      );
    }
  }
  return {
    token: refreshed.token,
    tokenExpiresAt: resolvedFromRefresh.expiresAt,
    googleSubject: resolvedFromRefresh.googleSubject,
    models: refreshed.models,
  };
}

export async function resolveAntigravitySubscription(
  body: CreateAntigravitySubscription,
  options: { dataDir?: string; signal?: AbortSignal } = {},
): Promise<ResolvedSubscription> {
  if (
    (body.token != null && body.label.includes(body.token)) ||
    (body.refreshToken !== undefined && body.label.includes(body.refreshToken))
  ) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  if (body.refreshToken !== undefined) {
    const resolved = await resolveGoogleRefreshOAuth(
      {
        refreshToken: body.refreshToken,
        authMethod: body.authMethod,
        token: body.token,
        expiresAt: body.expiresAt,
      },
      options,
    );
    return {
      ...body,
      token: resolved.token,
      expiresAt: null,
      tokenExpiresAt: resolved.tokenExpiresAt,
      googleSubject: resolved.googleSubject,
      models: resolved.models,
    };
  }
  if (body.token && isAntigravityOAuthAccessToken(body.token)) {
    const resolved = await resolveGoogleOAuth(body.token, body.expiresAt);
    return {
      ...body,
      expiresAt: resolved.expiresAt,
      tokenExpiresAt: resolved.expiresAt,
      googleSubject: resolved.googleSubject,
    };
  }
  return body;
}

export function createAntigravitySubscription(
  deps: Deps,
  teamId: string,
  body: ResolvedSubscription,
): AntigravitySubscription {
  const token = body.token ?? null;
  const refreshToken = body.refreshToken;
  assertLabelHidesToken(body.label, token);
  assertLabelHidesToken(body.label, refreshToken ?? null);
  const now = nowMs();
  let tokenCipher: string | null = null;
  let expiresAt: number | null = body.expiresAt ?? null;
  if (refreshToken !== undefined) {
    if (
      token === null ||
      !isAntigravityOAuthAccessToken(token) ||
      body.googleSubject === undefined ||
      body.tokenExpiresAt === undefined ||
      body.tokenExpiresAt <= now
    ) {
      throw new HttpError(400, 'A valid, verified Google OAuth credential is required.');
    }
    tokenCipher = sealBoundOAuth(deps.box, {
      token,
      tokenExpiresAt: body.tokenExpiresAt,
      refreshToken,
      authMethod: body.authMethod ?? 'consumer',
      subject: body.googleSubject,
    });
    expiresAt = null;
  } else if (token !== null) {
    if (isAntigravityOAuthAccessToken(token)) {
      if (body.googleSubject === undefined || expiresAt == null || expiresAt <= now) {
        throw new HttpError(400, 'A valid, verified Google OAuth access token is required.');
      }
      tokenCipher = sealBoundOAuth(deps.box, { token, subject: body.googleSubject });
    } else {
      tokenCipher = deps.box.seal(token);
    }
  }
  const row: Row = {
    id: newRecordId(),
    teamId,
    label: body.label,
    tokenCipher,
    runnerId: null,
    expiresAt,
    enabledAt: null,
    quotaWindows: null,
    models:
      body.models !== undefined && body.models.length > 0
        ? dedupeSubscriptionModels(body.models, true)
        : [],
    lastCheck: null,
    createdAt: now,
  };
  return deps.db.transaction((tx) => {
    const current = enabledRow(tx, teamId);
    const canEnable = row.expiresAt === null || row.expiresAt > now;
    const replaceExpired =
      canEnable &&
      current?.expiresAt != null &&
      current.expiresAt <= now &&
      runningStepCount(tx, current.id) === 0;
    if (replaceExpired) {
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
    const shouldEnable = canEnable && (current === undefined || replaceExpired);
    const runner = token === null ? subscriptionRunner(tx, teamId, body.runnerId) : undefined;
    if (token === null && body.runnerId !== undefined && runner === undefined)
      throw notFound('Runner');
    const stored = { ...row, runnerId: runner?.id ?? null, enabledAt: shouldEnable ? now : null };
    tx.insert(antigravitySubscription).values(stored).run();
    return toRecord(stored);
  });
}

export async function attachAntigravityOAuthCredential(
  deps: Deps,
  teamId: string,
  id: string,
  credential: AntigravityOAuthStepCredential,
  signal?: AbortSignal,
): Promise<AntigravitySubscription> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (row === undefined) throw notFound('Antigravity subscription connection');
  refuseWhileRunning(() => runningStepCount(deps.db, row.id), 'attach a credential to');
  const now = nowMs();
  const hasRefreshToken = credential.refreshToken !== undefined;
  if (
    (!hasRefreshToken && (credential.expiresAt === undefined || credential.expiresAt <= now)) ||
    (credential.token !== undefined && row.label.includes(credential.token)) ||
    (credential.refreshToken !== undefined && row.label.includes(credential.refreshToken))
  ) {
    throw new HttpError(400, 'Invalid Antigravity OAuth credential');
  }
  let subject: string | undefined;
  if (row.tokenCipher !== null) {
    if (!row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
      throw new HttpError(409, 'This subscription already has a credential');
    }
    if (!row.tokenCipher.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) {
      if (row.expiresAt === null || row.expiresAt > now) {
        throw new HttpError(409, 'This subscription already has a credential');
      }
      throw new HttpError(
        409,
        'This connection cannot be renewed safely. Add a new Google connection.',
      );
    }
    const existing = openBoundOAuth(deps.box, row.tokenCipher);
    const expired = row.expiresAt !== null && row.expiresAt <= now;
    const failedRefresh =
      existing.refreshToken !== undefined &&
      row.lastCheck?.ok === false &&
      row.lastCheck.reason === 'auth';
    if (!expired && !failedRefresh) {
      throw new HttpError(409, 'This subscription already has a credential');
    }
    subject = existing.subject;
  }
  let effectiveToken: string;
  let tokenExpiresAt: number;
  let googleSubject: string;
  let discoveredModels: AntigravitySubscriptionModel[] = [];
  if (credential.refreshToken !== undefined) {
    const resolvedRefresh = await resolveGoogleRefreshOAuth(
      {
        refreshToken: credential.refreshToken,
        authMethod: credential.authMethod,
        token: credential.token,
        expiresAt: credential.expiresAt,
      },
      { dataDir: deps.dataDir, signal },
    );
    effectiveToken = resolvedRefresh.token;
    tokenExpiresAt = resolvedRefresh.tokenExpiresAt;
    googleSubject = resolvedRefresh.googleSubject;
    discoveredModels = resolvedRefresh.models;
  } else if (credential.token !== undefined) {
    const resolved = await resolveGoogleOAuth(credential.token, credential.expiresAt);
    effectiveToken = credential.token;
    tokenExpiresAt = resolved.expiresAt;
    googleSubject = resolved.googleSubject;
  } else {
    throw new HttpError(400, 'Invalid Antigravity OAuth credential');
  }
  if (subject !== undefined && subject !== googleSubject) {
    throw new HttpError(
      409,
      'Sign in with the Google account originally used for this connection.',
    );
  }
  const saved = deps.db.transaction((tx) => {
    const fresh = subscriptionRow(tx, teamId, id);
    if (fresh === undefined) throw notFound('Antigravity subscription connection');
    if (
      fresh.tokenCipher !== row.tokenCipher ||
      fresh.expiresAt !== row.expiresAt ||
      fresh.lastCheck?.ok !== row.lastCheck?.ok ||
      fresh.lastCheck?.at !== row.lastCheck?.at ||
      fresh.lastCheck?.reason !== row.lastCheck?.reason
    ) {
      throw new HttpError(409, 'This subscription credential changed; try again.');
    }
    refuseWhileRunning(() => runningStepCount(tx, fresh.id), 'attach a credential to');
    if (
      (!hasRefreshToken && tokenExpiresAt <= nowMs()) ||
      fresh.label.includes(effectiveToken) ||
      (credential.token !== undefined && fresh.label.includes(credential.token)) ||
      (credential.refreshToken !== undefined && fresh.label.includes(credential.refreshToken))
    ) {
      throw new HttpError(400, 'Invalid Antigravity OAuth credential');
    }
    const payload: BoundOAuth = {
      token: effectiveToken,
      subject: googleSubject,
      ...(credential.refreshToken !== undefined
        ? {
            tokenExpiresAt,
            refreshToken: credential.refreshToken,
            authMethod: credential.authMethod ?? 'consumer',
          }
        : {}),
    };
    const seededModels =
      fresh.models.length === 0 && discoveredModels.length > 0
        ? dedupeSubscriptionModels(discoveredModels, true)
        : undefined;
    const updated = {
      tokenCipher: sealBoundOAuth(deps.box, payload),
      runnerId: null,
      expiresAt: hasRefreshToken ? null : tokenExpiresAt,
      ...(seededModels !== undefined ? { models: seededModels } : {}),
      quotaWindows: null,
      lastCheck: null,
    };
    tx.update(antigravitySubscription)
      .set(updated)
      .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
      .run();
    return { ...fresh, ...updated };
  });
  verificationWindows.get(deps.db)?.delete(id);
  upstreamModelsWindows.get(deps.db)?.delete(id);
  quotaProbes.get(deps.db)?.delete(id);
  return toRecord(saved);
}

export async function verifyAntigravitySubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
  options: { signal?: AbortSignal; ownerInitiated?: boolean } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(antigravitySubscription)
    .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
    .get();
  if (!row) throw notFound('Antigravity subscription connection');
  const isRefreshRow = isRefreshOAuthRow(deps.box, row.tokenCipher);
  if (options.ownerInitiated === false && isRefreshRow) {
    throw new HttpError(403, 'Only the instance owner can verify portable Google OAuth sign-in.');
  }
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return { ok: false, reason: 'auth' };
  const inFlight = activeVerifications.get(deps.db) ?? new Set<string>();
  if (inFlight.has(row.id)) {
    throw new HttpError(
      429,
      'A verification attempt is already running for this connection; try again shortly.',
    );
  }
  claimRateWindow(verificationWindows, deps.db, row.id, 'verification attempts');
  inFlight.add(row.id);
  activeVerifications.set(deps.db, inFlight);
  try {
    const ownerInitiated = options.ownerInitiated !== false;
    const raw = await timedCheck(
      () => verifyRowCredentials(deps, row, options.signal, ownerInitiated),
      {
        check: 'sign-in',
        command: row.tokenCipher === null ? 'agy acp · Runner sign-in' : 'Antigravity account API',
        via: row.tokenCipher === null || isRefreshRow ? 'cli' : 'api',
        model: null,
      },
    );
    const { reportedDurationMs, command, via, seededModels, ...rest } = raw;
    const check = {
      ...raw.check,
      command,
      via,
      durationMs: Math.max(raw.check.durationMs, reportedDurationMs ?? 0),
    };
    const result: AntigravitySubscriptionVerifyResult = { ...rest, check };
    if (!options.signal?.aborted) {
      deps.db.transaction((tx) => {
        const fresh = subscriptionRow(tx, teamId, row.id);
        if (
          fresh === undefined ||
          fresh.tokenCipher !== row.tokenCipher ||
          fresh.runnerId !== row.runnerId
        ) {
          return;
        }
        const modelsToSeed =
          ownerInitiated &&
          rest.ok &&
          fresh.tokenCipher !== null &&
          fresh.models.length === 0 &&
          seededModels !== undefined &&
          seededModels.length > 0
            ? dedupeSubscriptionModels(seededModels, true)
            : undefined;
        tx.update(antigravitySubscription)
          .set({
            lastCheck: check,
            ...(modelsToSeed !== undefined ? { models: modelsToSeed } : {}),
          })
          .where(
            and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, row.id)),
          )
          .run();
      });
    }
    return result;
  } finally {
    inFlight.delete(row.id);
  }
}

export async function antigravitySubscriptionUpstreamModels(
  deps: Deps & {
    machineHub: MachineWakeHub;
    ownerInitiated: boolean;
    apiKeyProbeRunnerGrant: (machineId: string) => string | null;
  },
  teamId: string,
  id: string,
  signal?: AbortSignal,
): Promise<UpstreamModelsResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Antigravity subscription connection');
  const fallback = (failure: ProviderFailure): UpstreamModelsResult => ({
    status: 'fallback',
    failure,
    httpStatus: null,
    models: defaultSeedModels(),
  });
  if (!deps.ownerInitiated) return fallback('auth');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return fallback('auth');
  claimRateWindow(upstreamModelsWindows, deps.db, row.id, 'model list attempts');
  if (row.tokenCipher === null) {
    const login = runnerLogin(deps.db, row);
    if (login.status === 'ok' && login.models.length > 0) {
      const models = [
        ...new Map(
          login.models
            .filter((entry) => !isInternalAntigravityModelId(entry.id))
            .map(({ id: modelId, name }) => [modelId, { id: modelId, name }]),
        ).values(),
      ];
      return models.length > 0 ? { status: 'ok', models } : fallback('no-model');
    }
    return fallback(
      login.status === 'missing_local_login'
        ? 'auth'
        : login.status === 'ok'
          ? 'no-model'
          : 'not-found',
    );
  }

  const credentialStillAvailable = () => {
    const current = subscriptionRow(deps.db, teamId, id);
    return (
      current !== undefined &&
      current.tokenCipher === row.tokenCipher &&
      (current.expiresAt === null || current.expiresAt > nowMs())
    );
  };
  let token: string;
  try {
    if (row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
      const stored = openStoredOAuth(deps.box, row.tokenCipher);
      if (stored.refreshToken !== undefined) {
        const probed = await probeAntigravityOAuth(
          {
            refreshToken: stored.refreshToken,
            authMethod: stored.authMethod ?? 'consumer',
          },
          { dataDir: deps.dataDir, signal },
        );
        if (!credentialStillAvailable()) return fallback('auth');
        if (probed.result.ok && probed.models.length > 0) {
          return { status: 'ok', models: probed.models };
        }
        if (
          !probed.result.ok &&
          (probed.result.reason === 'auth' || probed.result.reason === 'timeout')
        ) {
          return fallback(probed.result.reason);
        }
        const accessToken =
          probed.accessToken ??
          (stored.token !== undefined &&
          stored.tokenExpiresAt !== undefined &&
          stored.tokenExpiresAt > nowMs()
            ? stored.token
            : undefined);
        if (accessToken === undefined) return fallback('upstream');
        const entitlements = await fetchAntigravityEntitlements(accessToken, signal);
        if (entitlements.status === 'failed') return fallback(entitlements.failure);
        return credentialStillAvailable() ? entitlements : fallback('auth');
      }
      if (row.expiresAt === null || row.expiresAt <= nowMs()) return fallback('auth');
      const probed = await probeAntigravityOAuthAccessToken(
        { token: stored.token, expiresAt: row.expiresAt },
        { dataDir: deps.dataDir, signal },
      );
      if (!credentialStillAvailable()) return fallback('auth');
      if (probed.result.ok && probed.models.length > 0) {
        return { status: 'ok', models: probed.models };
      }
      if (
        !probed.result.ok &&
        (probed.result.reason === 'auth' || probed.result.reason === 'timeout')
      ) {
        return fallback(probed.result.reason);
      }
      const entitlements = await fetchAntigravityEntitlements(stored.token, signal);
      if (entitlements.status === 'failed') return fallback(entitlements.failure);
      return credentialStillAvailable() ? entitlements : fallback('auth');
    }
    token = deps.box.open(row.tokenCipher);
  } catch {
    return fallback('auth');
  }

  const grants = new Map<string, string>();
  for (const runner of deps.db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true)))
    .orderBy(machine.id)
    .all()) {
    if (!deps.machineHub.isConnected(runner.id)) continue;
    const grant = deps.apiKeyProbeRunnerGrant(runner.id);
    if (grant !== null) grants.set(runner.id, grant);
  }
  const isProbeAuthorized = (machineId: string) => {
    const grant = grants.get(machineId);
    try {
      return (
        grant !== undefined &&
        credentialStillAvailable() &&
        deps.apiKeyProbeRunnerGrant(machineId) === grant
      );
    } catch {
      return false;
    }
  };
  const probed = await dispatchAntigravityModelProbe(
    deps.machineHub,
    [...grants.keys()],
    () => token,
    isProbeAuthorized,
    signal,
  );
  if (probed.status === 'failed') return fallback(probed.failure);
  if (!isProbeAuthorized(probed.machineId)) return fallback('auth');
  const models = antigravityProbedCatalog(probed.models, token);
  return models.length > 0 ? { status: 'ok', models } : fallback('upstream');
}

function oauthCredentialFromRow(box: SecretBox, row: Row): AntigravityOAuthStepCredential {
  if (row.tokenCipher === null || !row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
    throw new HttpError(409, 'Subscription does not carry an OAuth credential.');
  }
  const stored = openStoredOAuth(box, row.tokenCipher);
  if (stored.refreshToken !== undefined) {
    const hasFreshAccessToken =
      stored.token !== undefined &&
      stored.tokenExpiresAt !== undefined &&
      stored.tokenExpiresAt > nowMs();
    return {
      kind: 'oauth-personal',
      refreshToken: stored.refreshToken,
      authMethod: stored.authMethod ?? 'consumer',
      ...(hasFreshAccessToken ? { token: stored.token, expiresAt: stored.tokenExpiresAt } : {}),
    };
  }
  if (row.expiresAt === null || stored.token === undefined) {
    throw new HttpError(409, 'Missing Antigravity OAuth expiration');
  }
  return {
    kind: 'oauth-personal',
    token: stored.token,
    expiresAt: row.expiresAt,
  };
}

function observedQuotaFresh(row: Row, now: number): boolean {
  return (row.quotaWindows ?? []).some(
    (window) => now - window.observedAt < ANTIGRAVITY_QUOTA_FRESH_MS,
  );
}

function isQuotaEligibleRow(row: Row, now: number): boolean {
  if (row.enabledAt === null) return false;
  if (row.expiresAt !== null && row.expiresAt <= now) return false;
  return row.tokenCipher === null || row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX);
}

async function probeAndStoreAntigravityQuota(
  deps: Deps,
  row: Row,
  signal?: AbortSignal,
): Promise<void> {
  if (deps.machineHub === undefined) return;
  const hub = deps.machineHub;
  const now = nowMs();
  if (!isQuotaEligibleRow(row, now)) return;

  let candidateIds: string[];
  let buildClaim: () => MachineAntigravityUsageProbeClaim;
  let isAuthorized: (machineId: string) => boolean;

  if (row.tokenCipher === null) {
    const { runner } = resolveBoundRunner(deps.db, row);
    if (
      runner === undefined ||
      !runner.online ||
      !hub.isConnected(runner.id) ||
      runner.capabilities?.antigravityUsage !== true ||
      runner.capabilities?.antigravity?.installed !== true ||
      runner.capabilities?.antigravity?.authenticated !== true
    ) {
      return;
    }
    candidateIds = [runner.id];
    buildClaim = () => ({ mode: 'host' });
    isAuthorized = (machineId: string) => {
      const fresh = subscriptionRow(deps.db, row.teamId, row.id);
      if (
        fresh === undefined ||
        fresh.enabledAt === null ||
        fresh.tokenCipher !== null ||
        (fresh.expiresAt !== null && fresh.expiresAt <= nowMs())
      ) {
        return false;
      }
      const resolved = resolveBoundRunner(deps.db, fresh);
      return (
        resolved.runnerId === machineId &&
        resolved.runner !== undefined &&
        resolved.runner.online &&
        resolved.runner.capabilities?.antigravityUsage === true &&
        resolved.runner.capabilities?.antigravity?.installed === true &&
        resolved.runner.capabilities?.antigravity?.authenticated === true
      );
    };
  } else {
    let credential: AntigravityOAuthStepCredential;
    try {
      credential = oauthCredentialFromRow(deps.box, row);
    } catch {
      return;
    }
    const runners = registeredRunners(deps.db, row.teamId).filter(
      (runner) =>
        runner.online &&
        hub.isConnected(runner.id) &&
        runner.capabilities?.antigravityUsage === true &&
        runner.capabilities?.antigravity?.installed !== false,
    );
    if (runners.length === 0) return;
    candidateIds = runners.map((runner) => runner.id);
    buildClaim = () => ({ mode: 'oauth', credential });
    isAuthorized = (machineId: string) => {
      const fresh = subscriptionRow(deps.db, row.teamId, row.id);
      if (
        fresh === undefined ||
        fresh.enabledAt === null ||
        fresh.tokenCipher !== row.tokenCipher ||
        (fresh.expiresAt !== null && fresh.expiresAt <= nowMs())
      ) {
        return false;
      }
      const runner = subscriptionRunner(deps.db, row.teamId, machineId);
      return (
        runner?.online === true &&
        runner.capabilities?.antigravityUsage === true &&
        runner.capabilities?.antigravity?.installed !== false
      );
    };
  }

  const probed = await dispatchAntigravityUsageProbe(
    hub,
    candidateIds,
    buildClaim,
    isAuthorized,
    signal,
  );
  if (probed.status !== 'ok' || !isAuthorized(probed.machineId)) return;

  deps.db.transaction((tx) => {
    const fresh = subscriptionRow(tx, row.teamId, row.id);
    if (
      fresh === undefined ||
      fresh.enabledAt === null ||
      fresh.tokenCipher !== row.tokenCipher ||
      fresh.runnerId !== row.runnerId
    ) {
      return;
    }
    tx.update(antigravitySubscription)
      .set({ quotaWindows: probed.windows })
      .where(
        and(eq(antigravitySubscription.teamId, row.teamId), eq(antigravitySubscription.id, row.id)),
      )
      .run();
  });
}

export async function refreshAntigravityQuota(
  deps: Deps,
  teamId: string,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<AntigravitySubscriptionListEntry[]> {
  const row = activeSubscriptionRow(deps, teamId);
  const now = nowMs();
  if (
    row !== undefined &&
    isQuotaEligibleRow(row, now) &&
    (options.force === true || !observedQuotaFresh(row, now))
  ) {
    const probes =
      quotaProbes.get(deps.db) ??
      new Map<string, { at: number; pending: boolean; done: Promise<void> }>();
    quotaProbes.set(deps.db, probes);
    const last = probes.get(row.id);
    if (last?.pending) {
      await last.done;
    } else if (
      last === undefined ||
      options.force === true ||
      now - last.at >= ANTIGRAVITY_QUOTA_REFRESH_MS
    ) {
      const entry = {
        at: now,
        pending: true,
        done: Promise.resolve(),
      };
      entry.done = probeAndStoreAntigravityQuota(deps, row, options.signal)
        .catch(() => undefined)
        .finally(() => {
          entry.pending = false;
        });
      probes.set(row.id, entry);
      await entry.done;
    }
  }
  return listAntigravitySubscriptions(deps, teamId);
}

export async function pollAllAntigravityQuotas(deps: Deps): Promise<void> {
  const now = nowMs();
  const rows = deps.db
    .select({ teamId: antigravitySubscription.teamId })
    .from(antigravitySubscription)
    .where(
      and(
        isNotNull(antigravitySubscription.enabledAt),
        or(isNull(antigravitySubscription.expiresAt), gt(antigravitySubscription.expiresAt, now)),
      ),
    )
    .all();
  const teamIds = [...new Set(rows.map((row) => row.teamId))];
  for (const teamId of teamIds) {
    await refreshAntigravityQuota(deps, teamId).catch(() => undefined);
  }
}

export function openAntigravitySubscription(
  deps: Deps,
  teamId: string,
  provider: string | null | undefined,
  boundSubscriptionId: string | null | undefined,
): string | undefined {
  if (provider !== 'antigravity') return undefined;
  if (!boundSubscriptionId)
    throw new HttpError(409, 'The step has no bound Antigravity connection.');
  const row = subscriptionRow(deps.db, teamId, boundSubscriptionId);
  if (row === undefined) throw new HttpError(409, 'The bound Antigravity connection is missing.');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) {
    throw new HttpError(409, 'The bound Antigravity connection has expired.');
  }
  if (row.tokenCipher === null) return undefined;
  if (!row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
    return deps.box.open(row.tokenCipher);
  }
  return JSON.stringify(oauthCredentialFromRow(deps.box, row));
}

export function enabledAntigravitySubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
  at?: number,
): string | null {
  return activeSubscriptionRow(deps, teamId, at)?.id ?? null;
}

export function activeAntigravitySource(db: Pick<Db, 'select'>, teamId: string) {
  const row = activeSubscriptionRow({ db }, teamId);
  if (row === undefined) return { kind: 'none' } as const;
  if (row.tokenCipher !== null) {
    if (row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
      return { kind: 'oauth-personal', models: row.models } as const;
    }
    return { kind: 'token', models: row.models } as const;
  }
  return { kind: 'host', login: runnerLogin(db, row), models: row.models } as const;
}

export function antigravitySubscriptionAllowsRunner(
  db: Pick<Db, 'select'>,
  teamId: string,
  runnerId: string,
  capabilities?: MachineCapabilities | null,
): boolean {
  const source = activeAntigravitySource(db, teamId);
  if (source.kind === 'none') return false;
  if (source.kind === 'token') return true;
  if (source.kind === 'oauth-personal') {
    if (capabilities !== undefined) return capabilities?.antigravityOAuthProfile === true;
    const row = db
      .select({ capabilities: machine.capabilities })
      .from(machine)
      .where(and(eq(machine.teamId, teamId), eq(machine.id, runnerId)))
      .get();
    return row?.capabilities?.antigravityOAuthProfile === true;
  }
  return source.login.status === 'ok' && source.login.runnerId === runnerId;
}

function activeSubscriptionRow(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
  at = nowMs(),
): Row | undefined {
  return deps.db
    .select()
    .from(antigravitySubscription)
    .where(
      and(
        eq(antigravitySubscription.teamId, teamId),
        isNotNull(antigravitySubscription.enabledAt),
        or(isNull(antigravitySubscription.expiresAt), gt(antigravitySubscription.expiresAt, at)),
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
    refuseWhileRunning(() => runningStepCount(tx, row.id), 'delete');
    return (
      tx
        .delete(antigravitySubscription)
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run().changes > 0
    );
  });
}
