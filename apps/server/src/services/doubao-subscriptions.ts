import type {
  CreateDoubaoSubscription,
  DoubaoRunnerLogin,
  DoubaoSubscription,
  DoubaoSubscriptionListEntry,
  DoubaoSubscriptionModel,
  DoubaoSubscriptionVerifyResult,
  MachineCapabilities,
  PatchDoubaoSubscription,
  ProviderFailure,
  UpstreamModelsResult,
} from '@cairn/shared';
import { isRegisteredMachine } from '@cairn/shared';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, doubaoSubscription, machine, step, todo } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { requestDoubaoVerify } from './machine-doubao-verify.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { timedCheck } from './subscription-check.js';
import {
  claimRateWindow,
  dedupeSubscriptionModels,
  refuseWhileRunning,
} from './subscription-helpers.js';
import { subscriptionUsageStats } from './subscription-usage.js';

export const DEFAULT_DOUBAO_FALLBACK_MODELS: readonly DoubaoSubscriptionModel[] = [
  { id: '4', name: 'Doubao 2.1 Turbo' },
];

export type DoubaoAccountStepsPage = {
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
  machineHub?: MachineWakeHub;
  verifyTimeoutMs?: number;
};

type Row = typeof doubaoSubscription.$inferSelect;
type RunnerDb = Pick<Db, 'select'>;
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

function toRecord(row: Row): DoubaoSubscription {
  return {
    id: row.id,
    kind: 'doubao-subscription',
    label: row.label,
    runnerId: row.runnerId,
    enabled: row.enabledAt !== null,
    enabledAt: row.enabledAt,
    models: row.models,
    createdAt: row.createdAt,
  };
}

function subscriptionRow(db: Pick<Db, 'select'>, teamId: string, id: string): Row | undefined {
  return db
    .select()
    .from(doubaoSubscription)
    .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, id)))
    .get();
}

function enabledRow(db: Pick<Db, 'select'>, teamId: string): Row | undefined {
  return db
    .select()
    .from(doubaoSubscription)
    .where(and(eq(doubaoSubscription.teamId, teamId), isNotNull(doubaoSubscription.enabledAt)))
    .get();
}

function runningStepCount(db: Pick<Db, 'select'>, subscriptionId: string): number {
  return (
    db
      .select({ n: count() })
      .from(step)
      .where(and(eq(step.status, 'claimed'), eq(step.doubaoSubscriptionId, subscriptionId)))
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

function runnerLoginStatus(runner: Runner): DoubaoRunnerLogin['status'] {
  const report = runner.capabilities?.doubao;
  if (!runner.online) return 'unavailable';
  if (report === undefined) return 'not_installed';
  if (report.platformSupported === false && !report.installed) return 'unsupported_platform';
  if (!report.installed) return 'not_installed';
  return report.authenticated === true ? 'ok' : 'missing_local_login';
}

function teamRunnerLogins(db: Pick<Db, 'select'>, teamId: string): DoubaoRunnerLogin[] {
  return registeredRunners(db, teamId).map((runner) => ({
    runnerId: runner.id,
    name: runner.name,
    online: runner.online,
    installed: runner.capabilities?.doubao?.installed === true,
    ...(runner.capabilities?.doubao?.platformSupported !== undefined
      ? { platformSupported: runner.capabilities.doubao.platformSupported }
      : {}),
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
  return (
    registered.find((r) => runnerLoginStatus(r) === 'ok') ??
    registered.find((r) => r.online && r.capabilities?.doubao?.installed === true) ??
    (registered.length === 1 ? registered[0] : undefined)
  );
}

function resolveBoundRunner(db: Pick<Db, 'select'>, row: Row) {
  const runnerId = row.runnerId ?? null;
  const runner = runnerId === null ? undefined : subscriptionRunner(db, row.teamId, runnerId);
  return { runnerId, runner };
}

function sharedRunnerModels(runners: readonly Runner[]): DoubaoSubscriptionModel[] {
  if (runners.length === 0) return [];
  const firstModels = (runners[0]!.capabilities?.doubao?.models ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    ...(m.thinkingLevels !== undefined ? { thinkingLevels: m.thinkingLevels } : {}),
    ...(m.thinkingDefault !== undefined ? { thinkingDefault: m.thinkingDefault } : {}),
  }));
  const shared =
    runners.length === 1
      ? firstModels
      : firstModels.filter((m) =>
          runners
            .slice(1)
            .every((r) => (r.capabilities?.doubao?.models ?? []).some((rm) => rm.id === m.id)),
        );
  return dedupeSubscriptionModels(shared, true);
}

function runnerLogin(db: Pick<Db, 'select'>, row: Row) {
  const { runnerId, runner } = resolveBoundRunner(db, row);
  if (runnerId === null) {
    const registered = registeredRunners(db, row.teamId);
    const authed = registered.filter((r) => runnerLoginStatus(r) === 'ok');
    if (authed.length > 0) {
      const first = authed[0]!;
      return {
        status: 'ok' as const,
        runnerId: first.id,
        hostname: authed.length === 1 ? first.name : `${authed.length} 台已登录电脑`,
        offline: false,
        models: sharedRunnerModels(authed),
      };
    }
    const online = registered.filter((r) => r.online);
    const cand =
      online.find((r) => runnerLoginStatus(r) === 'missing_local_login') ??
      online.find((r) => runnerLoginStatus(r) === 'not_installed') ??
      online[0] ??
      registered[0];
    if (cand === undefined || !cand.online) {
      return {
        status: 'unavailable' as const,
        runnerId: cand?.id ?? null,
        hostname: cand?.name ?? null,
        offline: true,
        models: [] as DoubaoSubscriptionModel[],
      };
    }
    return {
      status: runnerLoginStatus(cand),
      runnerId: cand.id,
      hostname: cand.name,
      offline: false,
      models: [] as DoubaoSubscriptionModel[],
    };
  }
  const report = runner?.capabilities?.doubao;
  if (runner === undefined || !runner.online) {
    return {
      status: 'unavailable' as const,
      runnerId,
      hostname: runner?.name ?? null,
      offline: runnerId !== null && runner?.online !== true,
      models: [] as DoubaoSubscriptionModel[],
    };
  }
  if (report === undefined || !report.installed) {
    const status =
      report?.platformSupported === false
        ? ('unsupported_platform' as const)
        : ('not_installed' as const);
    return {
      status,
      runnerId: runner.id,
      hostname: runner.name,
      offline: false,
      models: [] as DoubaoSubscriptionModel[],
    };
  }
  if (report.authenticated !== true) {
    return {
      status: 'missing_local_login' as const,
      runnerId: runner.id,
      hostname: runner.name,
      offline: false,
      models: [] as DoubaoSubscriptionModel[],
    };
  }
  return {
    status: 'ok' as const,
    runnerId: runner.id,
    hostname: runner.name,
    offline: false,
    models: (report.models ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.thinkingLevels !== undefined ? { thinkingLevels: m.thinkingLevels } : {}),
      ...(m.thinkingDefault !== undefined ? { thinkingDefault: m.thinkingDefault } : {}),
    })),
  };
}

export function createDoubaoSubscription(
  deps: Deps,
  teamId: string,
  body: CreateDoubaoSubscription,
): DoubaoSubscription {
  const now = nowMs();
  const created = deps.db.transaction((tx) => {
    let runnerId: string | null = null;
    let liveModels: DoubaoSubscriptionModel[] = [];
    if (body.runnerId !== undefined && body.runnerId !== null) {
      const runner = subscriptionRunner(tx, teamId, body.runnerId);
      if (!runner) throw notFound('Runner');
      runnerId = runner.id;
      if (
        runner.online &&
        runner.capabilities?.doubao?.installed === true &&
        runner.capabilities?.doubao?.authenticated === true
      ) {
        liveModels = dedupeSubscriptionModels(runner.capabilities.doubao.models ?? [], true);
      }
    } else {
      liveModels = [];
    }
    const current = enabledRow(tx, teamId);
    const enabledAt = current === undefined ? now : null;
    const row: Row = {
      id: newRecordId(),
      teamId,
      label: body.label,
      runnerId,
      enabledAt,
      models: liveModels,
      lastCheck: null,
      createdAt: now,
    };
    tx.insert(doubaoSubscription).values(row).run();
    return row;
  });
  if (created.enabledAt !== null) deps.machineHub?.wake(teamId);
  return toRecord(created);
}

export function patchDoubaoSubscription(
  deps: Deps,
  teamId: string,
  id: string,
  patch: PatchDoubaoSubscription,
): DoubaoSubscription {
  const models =
    patch.models === undefined ? undefined : dedupeSubscriptionModels(patch.models, true);
  let runnerChanged = false;
  const updated = deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) throw notFound('Doubao subscription connection');
    let nextRunnerId = row.runnerId;
    if (patch.runnerId !== undefined && patch.runnerId !== row.runnerId) {
      refuseWhileRunning(() => runningStepCount(tx, row.id), 'rebind');
      if (patch.runnerId === null) {
        nextRunnerId = null;
      } else {
        const targetRunner = subscriptionRunner(tx, teamId, patch.runnerId);
        if (!targetRunner) throw notFound('Runner');
        nextRunnerId = targetRunner.id;
      }
      runnerChanged = true;
    }
    const changes = {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(models !== undefined ? { models } : {}),
      ...(nextRunnerId !== row.runnerId ? { runnerId: nextRunnerId, lastCheck: null } : {}),
    };
    if (Object.keys(changes).length > 0) {
      tx.update(doubaoSubscription)
        .set(changes)
        .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, id)))
        .run();
    }
    return toRecord({ ...row, ...changes });
  });
  if (runnerChanged) {
    verificationWindows.get(deps.db)?.delete(id);
    upstreamModelsWindows.get(deps.db)?.delete(id);
    deps.machineHub?.wake(teamId);
  }
  return updated;
}

export function enableDoubaoSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): DoubaoSubscription {
  const enabledAt = nowMs();
  const updated = deps.db.transaction((tx) => {
    const fresh = subscriptionRow(tx, teamId, id);
    if (!fresh) throw notFound('Doubao subscription connection');
    if (fresh.enabledAt !== null) return toRecord(fresh);
    const current = enabledRow(tx, teamId);
    if (current) {
      refuseWhileRunning(() => runningStepCount(tx, current.id), 'switch away from');
      tx.update(doubaoSubscription)
        .set({ enabledAt: null })
        .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, current.id)))
        .run();
    }
    const login = runnerLogin(tx, fresh);
    const seeded =
      fresh.models.length === 0 && login.status === 'ok' && login.models.length > 0
        ? dedupeSubscriptionModels(login.models, true)
        : undefined;
    tx.update(doubaoSubscription)
      .set({ enabledAt, ...(seeded !== undefined ? { models: seeded } : {}) })
      .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, id)))
      .run();
    return toRecord({ ...fresh, enabledAt, ...(seeded !== undefined ? { models: seeded } : {}) });
  });
  deps.machineHub?.wake(teamId);
  return updated;
}

export function disableDoubaoSubscription(
  deps: Deps,
  teamId: string,
  id: string,
): DoubaoSubscription {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) throw notFound('Doubao subscription connection');
    if (row.enabledAt === null) return toRecord(row);
    refuseWhileRunning(() => runningStepCount(tx, row.id), 'disable');
    tx.update(doubaoSubscription)
      .set({ enabledAt: null })
      .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, id)))
      .run();
    return toRecord({ ...row, enabledAt: null });
  });
}

export function deleteDoubaoSubscription(deps: { db: Db }, teamId: string, id: string): boolean {
  return deps.db.transaction((tx) => {
    const row = subscriptionRow(tx, teamId, id);
    if (!row) return false;
    refuseWhileRunning(() => runningStepCount(tx, row.id), 'delete');
    return (
      tx
        .delete(doubaoSubscription)
        .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, id)))
        .run().changes > 0
    );
  });
}

export async function verifyDoubaoSubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<DoubaoSubscriptionVerifyResult> {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Doubao subscription connection');
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
    const resolved = resolveBoundRunner(deps.db, row);
    const runner =
      resolved.runnerId === null ? subscriptionRunner(deps.db, teamId) : resolved.runner;
    const runnerName = runner?.name ?? null;
    const command = runnerName ? `doubao · ${runnerName}` : 'doubao · Runner sign-in';
    const raw = await timedCheck(
      async () => {
        if (runner === undefined || !runner.online || deps.machineHub === undefined) {
          return {
            ok: false as const,
            reason: 'unavailable' as const,
            runnerName,
            reportedDurationMs: undefined,
          };
        }
        const outcome = await requestDoubaoVerify({ machineHub: deps.machineHub }, runner.id, {
          ...(deps.verifyTimeoutMs === undefined ? {} : { timeoutMs: deps.verifyTimeoutMs }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return {
          ok: outcome.ok,
          ...(outcome.ok ? {} : { reason: outcome.reason }),
          runnerName,
          reportedDurationMs: outcome.durationMs,
        };
      },
      { check: 'sign-in', command, via: 'cli', model: null },
    );
    const { reportedDurationMs, runnerName: checkedRunnerName, ...rest } = raw;
    const check = {
      ...raw.check,
      durationMs: Math.max(raw.check.durationMs, reportedDurationMs ?? 0),
    };
    const result: DoubaoSubscriptionVerifyResult = {
      ok: rest.ok,
      ...(rest.ok ? {} : { reason: rest.reason }),
      ...(checkedRunnerName !== undefined ? { runnerName: checkedRunnerName } : {}),
      check,
    };
    if (!options.signal?.aborted) {
      deps.db.transaction((tx) => {
        const fresh = subscriptionRow(tx, teamId, row.id);
        if (fresh === undefined || fresh.runnerId !== row.runnerId) return;
        const freshLogin = runnerLogin(tx, fresh);
        const modelsToSeed =
          rest.ok &&
          fresh.models.length === 0 &&
          freshLogin.status === 'ok' &&
          freshLogin.models.length > 0
            ? dedupeSubscriptionModels(freshLogin.models, true)
            : undefined;
        tx.update(doubaoSubscription)
          .set({
            lastCheck: check,
            ...(modelsToSeed !== undefined ? { models: modelsToSeed } : {}),
          })
          .where(and(eq(doubaoSubscription.teamId, teamId), eq(doubaoSubscription.id, row.id)))
          .run();
      });
    }
    return result;
  } finally {
    inFlight.delete(row.id);
  }
}

export function listDoubaoUpstreamModels(
  deps: Deps,
  teamId: string,
  id: string,
): UpstreamModelsResult {
  const row = subscriptionRow(deps.db, teamId, id);
  if (!row) throw notFound('Doubao subscription connection');
  claimRateWindow(upstreamModelsWindows, deps.db, row.id, 'model list attempts');
  const login = runnerLogin(deps.db, row);
  if (login.status === 'ok' && login.models.length > 0) {
    return {
      status: 'ok',
      models: login.models.map(({ id: modelId, name }) => ({ id: modelId, name })),
    };
  }
  const failure: ProviderFailure =
    login.status === 'missing_local_login'
      ? 'auth'
      : login.status === 'ok'
        ? 'no-model'
        : 'not-found';
  return {
    status: 'fallback',
    failure,
    httpStatus: null,
    models: [],
  };
}

const STEP_KINDS_SHOWN = ['build', 'plan', 'chief', 'review', 'merge'] as const;

export function listDoubaoSubscriptionSteps(
  deps: { db: Db },
  teamId: string,
  id: string,
  limit: number,
): DoubaoAccountStepsPage {
  if (!subscriptionRow(deps.db, teamId, id)) {
    throw notFound('Doubao subscription connection');
  }
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo, threadRow: chiefThread })
    .from(step)
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(step.doubaoSubscriptionId, id),
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

export function listDoubaoSubscriptions(
  deps: Pick<Deps, 'db'>,
  teamId: string,
): { subscriptions: DoubaoSubscriptionListEntry[]; runnerLogins: DoubaoRunnerLogin[] } {
  const rows = deps.db
    .select()
    .from(doubaoSubscription)
    .where(eq(doubaoSubscription.teamId, teamId))
    .orderBy(desc(doubaoSubscription.createdAt), desc(doubaoSubscription.id))
    .all();
  const now = nowMs();
  const usage = subscriptionUsageStats(
    deps.db,
    step.doubaoSubscriptionId,
    rows.map((row) => row.id),
    now - DAY_MS,
  );
  const runnerLogins = teamRunnerLogins(deps.db, teamId);
  return {
    runnerLogins,
    subscriptions: rows.map((row) => {
      const stats = usage.get(row.id);
      const login = runnerLogin(deps.db, row);
      const runnerModels = login.status === 'ok' ? login.models : [];
      const models =
        row.models.length > 0 && runnerModels.length > 0
          ? row.models.filter((model) => runnerModels.some((entry) => entry.id === model.id))
          : row.models;
      return {
        ...toRecord({ ...row, models }),
        runnerName: login.hostname,
        runnerLogin: login.status,
        runnerOffline: login.offline,
        runnerModels,
        runnerLogins,
        lastUsedAt: stats?.lastUsedAt ?? null,
        stepsLast24h: stats?.stepsLast24h ?? 0,
        lastCheck: row.lastCheck,
      };
    }),
  };
}

export function enabledDoubaoSubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): string | null {
  return enabledRow(deps.db, teamId)?.id ?? null;
}

export function activeDoubaoSource(db: Pick<Db, 'select'>, teamId: string) {
  const row = enabledRow(db, teamId);
  if (row === undefined) return { kind: 'none' } as const;
  return {
    kind: 'host' as const,
    subscriptionId: row.id,
    runnerId: row.runnerId,
    models: row.models,
    login: runnerLogin(db, row),
  };
}

export function doubaoRunnerEligibility(
  db: RunnerDb,
  teamId: string,
  runnerId: string,
  capabilities?: MachineCapabilities | null,
): 'ok' | 'subscription' | 'unsupported' | 'login-required' {
  const source = activeDoubaoSource(db, teamId);
  if (source.kind !== 'host') return 'subscription';
  if (source.runnerId !== null && source.runnerId !== runnerId) return 'subscription';
  const caps =
    capabilities !== undefined
      ? capabilities
      : (db
          .select({ capabilities: machine.capabilities })
          .from(machine)
          .where(and(eq(machine.teamId, teamId), eq(machine.id, runnerId)))
          .get()?.capabilities ?? null);
  const report = caps?.doubao;
  if (report === undefined || report.platformSupported === false) return 'unsupported';
  if (!report.installed || !report.authenticated) return 'login-required';
  return 'ok';
}

export function doubaoSubscriptionAllowsRunner(
  db: RunnerDb,
  teamId: string,
  runnerId: string,
  capabilities?: MachineCapabilities | null,
): boolean {
  return doubaoRunnerEligibility(db, teamId, runnerId, capabilities) === 'ok';
}

export function doubaoUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  return activeDoubaoSource(db, teamId).kind === 'host';
}
