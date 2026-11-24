import type {
  AntigravityOAuthStepCredential,
  AntigravityRunnerLogin,
  AntigravitySubscription,
  AntigravitySubscriptionListEntry,
  AntigravitySubscriptionVerifyResult,
  CreateAntigravitySubscription,
  MachineCapabilities,
  PatchAntigravitySubscription,
  ProviderFailure,
  SecretBox,
  UpstreamModelsResult,
} from '@cairn/shared';
import {
  antigravityOAuthStepCredentialSchema,
  DEFAULT_ANTIGRAVITY_MODELS,
  isAntigravityOAuthAccessToken,
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
import { verifyAntigravitySubscription } from './antigravity-subscription-verification.js';
import { requestAntigravityVerify } from './machine-antigravity-verify.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { timedCheck } from './subscription-check.js';
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
const upstreamModelsWindows = new WeakMap<Db, Map<string, number>>();
const OAUTH_CIPHER_PREFIX = 'oauth-personal:';
const BOUND_OAUTH_CIPHER_PREFIX = `${OAUTH_CIPHER_PREFIX}v2:`;
const googleSubjectSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/);
const boundOAuthSchema = z.object({
  token: z.string().refine(isAntigravityOAuthAccessToken),
  subject: googleSubjectSchema,
});
const googleTokenInfoSchema = z.object({
  expires_in: z.union([z.number(), z.string().regex(/^-?\d+$/)]),
  sub: googleSubjectSchema,
});

type ResolvedSubscription = CreateAntigravitySubscription & { googleSubject?: string };

function openBoundOAuth(box: SecretBox, cipher: string): z.infer<typeof boundOAuthSchema> {
  try {
    return boundOAuthSchema.parse(
      JSON.parse(box.open(cipher.slice(BOUND_OAUTH_CIPHER_PREFIX.length))),
    );
  } catch {
    throw new Error('Unable to open the saved Antigravity OAuth credential.');
  }
}

function sealBoundOAuth(box: SecretBox, token: string, subject: string): string {
  return `${BOUND_OAUTH_CIPHER_PREFIX}${box.seal(JSON.stringify({ token, subject }))}`;
}

function openCredential(box: SecretBox, cipher: string): string {
  if (cipher.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) return openBoundOAuth(box, cipher).token;
  return box.open(
    cipher.startsWith(OAUTH_CIPHER_PREFIX) ? cipher.slice(OAUTH_CIPHER_PREFIX.length) : cipher,
  );
}

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

function refuseWhileRunning(db: Pick<Db, 'select'>, row: Row, action: string): void {
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

async function verifyRowCredentials(
  deps: Deps,
  row: Row,
  signal?: AbortSignal,
): Promise<AntigravitySubscriptionVerifyResult & { reportedDurationMs?: number }> {
  if (row.tokenCipher !== null) {
    const cipher = row.tokenCipher;
    return Promise.resolve()
      .then(async (): Promise<AntigravitySubscriptionVerifyResult> => {
        const token = openCredential(deps.box, cipher);
        if (!cipher.startsWith(OAUTH_CIPHER_PREFIX)) return verifyAntigravitySubscription(token);
        if (row.expiresAt === null || row.expiresAt <= nowMs()) {
          return { ok: false, reason: 'auth' };
        }
        const result = await fetchAntigravityEntitlements(token);
        if (result.status === 'ok') return { ok: true };
        return {
          ok: false,
          reason:
            result.failure === 'auth' || result.failure === 'timeout' ? result.failure : 'failed',
        };
      })
      .catch((): AntigravitySubscriptionVerifyResult => ({ ok: false, reason: 'failed' }));
  }
  const { runner } = resolveBoundRunner(deps.db, row);
  if (runner === undefined) return { ok: false, reason: 'unavailable' };
  const runnerName = runner.name;
  if (!runner.online || deps.machineHub === undefined) {
    return { ok: false, reason: 'unavailable', runnerName };
  }
  const outcome = await requestAntigravityVerify({ machineHub: deps.machineHub }, runner.id, {
    ...(deps.verifyTimeoutMs === undefined ? {} : { timeoutMs: deps.verifyTimeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    ok: outcome.ok,
    ...(outcome.ok ? {} : { reason: outcome.reason }),
    runnerName,
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
  if (
    row.tokenCipher !== null &&
    patch.label?.includes(openCredential(deps.box, row.tokenCipher))
  ) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
  let models: Row['models'] | undefined;
  if (patch.models !== undefined) {
    const seen = new Set<string>();
    models = patch.models.filter((model) => {
      if (model.id === '' || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }
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
    return {
      ...toRecord(login === undefined ? row : { ...row, runnerId: login.runnerId, models }),
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

export async function resolveAntigravitySubscription(
  body: CreateAntigravitySubscription,
): Promise<ResolvedSubscription> {
  if (!body.token || !isAntigravityOAuthAccessToken(body.token)) return body;
  return { ...body, ...(await resolveGoogleOAuth(body.token, body.expiresAt)) };
}

export function createAntigravitySubscription(
  deps: Deps,
  teamId: string,
  body: ResolvedSubscription,
): AntigravitySubscription {
  const token = body.token ?? null;
  const now = nowMs();
  let tokenCipher: string | null = null;
  if (token !== null) {
    if (body.label.includes(token)) {
      throw new HttpError(400, 'Connection label must not contain the token');
    }
    if (isAntigravityOAuthAccessToken(token)) {
      if (body.googleSubject === undefined || body.expiresAt == null || body.expiresAt <= now) {
        throw new HttpError(400, 'A valid, verified Google OAuth access token is required.');
      }
      tokenCipher = sealBoundOAuth(deps.box, token, body.googleSubject);
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
    expiresAt: body.expiresAt ?? null,
    enabledAt: null,
    models: [],
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
): Promise<AntigravitySubscription> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (row === undefined) throw notFound('Antigravity subscription connection');
  refuseWhileRunning(deps.db, row, 'attach a credential to');
  const now = nowMs();
  if (credential.expiresAt <= now || row.label.includes(credential.token)) {
    throw new HttpError(400, 'Invalid Antigravity OAuth credential');
  }
  let subject: string | undefined;
  if (row.tokenCipher !== null) {
    if (
      !row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX) ||
      row.expiresAt === null ||
      row.expiresAt > now
    ) {
      throw new HttpError(409, 'This subscription already has a credential');
    }
    if (!row.tokenCipher.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) {
      throw new HttpError(
        409,
        'This connection cannot be renewed safely. Add a new Google connection.',
      );
    }
    subject = openBoundOAuth(deps.box, row.tokenCipher).subject;
  }
  const resolved = await resolveGoogleOAuth(credential.token, credential.expiresAt);
  if (subject !== undefined && subject !== resolved.googleSubject) {
    throw new HttpError(
      409,
      'Sign in with the Google account originally used for this connection.',
    );
  }
  const saved = deps.db.transaction((tx) => {
    const fresh = subscriptionRow(tx, teamId, id);
    if (fresh === undefined) throw notFound('Antigravity subscription connection');
    if (fresh.tokenCipher !== row.tokenCipher || fresh.expiresAt !== row.expiresAt) {
      throw new HttpError(409, 'This subscription credential changed; try again.');
    }
    refuseWhileRunning(tx, fresh, 'attach a credential to');
    if (resolved.expiresAt <= nowMs() || fresh.label.includes(credential.token)) {
      throw new HttpError(400, 'Invalid Antigravity OAuth credential');
    }
    const updated = {
      tokenCipher: sealBoundOAuth(deps.box, credential.token, resolved.googleSubject),
      runnerId: null,
      expiresAt: resolved.expiresAt,
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
  return toRecord(saved);
}

export async function verifyAntigravitySubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(antigravitySubscription)
    .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
    .get();
  if (!row) throw notFound('Antigravity subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return { ok: false };
  claimRateWindow(verificationWindows, deps.db, row.id, 'verification attempts');
  const raw = await timedCheck(() => verifyRowCredentials(deps, row, opts.signal), {
    check: 'sign-in',
    command: row.tokenCipher === null ? 'agy acp · Runner sign-in' : 'Antigravity account API',
    model: null,
  });
  const { reportedDurationMs, ...rest } = raw;
  const check = {
    ...raw.check,
    command:
      row.tokenCipher === null && rest.runnerName
        ? `agy acp · ${rest.runnerName}`
        : raw.check.command,
    durationMs: Math.max(raw.check.durationMs, reportedDurationMs ?? 0),
  };
  const result: AntigravitySubscriptionVerifyResult = { ...rest, check };
  if (!opts.signal?.aborted) {
    deps.db
      .update(antigravitySubscription)
      .set({ lastCheck: check })
      .where(
        and(
          eq(antigravitySubscription.teamId, teamId),
          eq(antigravitySubscription.id, row.id),
          row.tokenCipher === null
            ? isNull(antigravitySubscription.tokenCipher)
            : eq(antigravitySubscription.tokenCipher, row.tokenCipher),
          row.runnerId === null
            ? isNull(antigravitySubscription.runnerId)
            : eq(antigravitySubscription.runnerId, row.runnerId),
        ),
      )
      .run();
  }
  return result;
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
    models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
  });
  if (!deps.ownerInitiated) return fallback('auth');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return fallback('auth');
  claimRateWindow(upstreamModelsWindows, deps.db, row.id, 'model list attempts');
  if (row.tokenCipher === null) {
    const login = runnerLogin(deps.db, row);
    if (login.status === 'ok' && login.models.length > 0) {
      const models = [...new Map(login.models.map(({ id, name }) => [id, { id, name }])).values()];
      return { status: 'ok', models };
    }
    return fallback(
      login.status === 'missing_local_login'
        ? 'auth'
        : login.status === 'ok'
          ? 'no-model'
          : 'not-found',
    );
  }

  let token: string;
  try {
    token = openCredential(deps.box, row.tokenCipher);
  } catch {
    return fallback('auth');
  }
  const credentialStillAvailable = () => {
    const current = subscriptionRow(deps.db, teamId, id);
    return (
      current !== undefined &&
      current.tokenCipher === row.tokenCipher &&
      (current.expiresAt === null || current.expiresAt > nowMs())
    );
  };
  if (row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX)) {
    if (row.expiresAt === null) return fallback('auth');
    const entitlements = await fetchAntigravityEntitlements(token, signal);
    if (entitlements.status === 'failed') return fallback(entitlements.failure);
    return credentialStillAvailable() ? entitlements : fallback('auth');
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
  const oauth = row.tokenCipher.startsWith(OAUTH_CIPHER_PREFIX);
  const token = openCredential(deps.box, row.tokenCipher);
  if (!oauth) return token;
  if (row.expiresAt === null) throw new HttpError(409, 'Missing Antigravity OAuth expiration');
  const credential: AntigravityOAuthStepCredential = {
    kind: 'oauth-personal',
    token,
    expiresAt: row.expiresAt,
  };
  return JSON.stringify(credential);
}

export function enabledAntigravitySubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
  at?: number,
): string | null {
  return activeSubscriptionRow(deps, teamId, at)?.id ?? null;
}

export function activeAntigravitySource(db: RunnerDb, teamId: string) {
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
  db: RunnerDb,
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
    refuseWhileRunning(tx, row, 'delete');
    return (
      tx
        .delete(antigravitySubscription)
        .where(and(eq(antigravitySubscription.teamId, teamId), eq(antigravitySubscription.id, id)))
        .run().changes > 0
    );
  });
}
